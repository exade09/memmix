from __future__ import annotations

import hashlib
import inspect
import json
import os
import unittest
from io import BytesIO
from unittest.mock import patch

from PIL import Image

from axiom_scanner.analysis.wavespeed_hybrid import HybridImage
from axiom_scanner.security.fields import (
    FieldError,
    require_initial_buy,
    require_optional_telegram,
    require_optional_twitter,
    require_optional_website,
    require_ticker,
)
from axiom_scanner.security.images import encode_launch_avatar
from axiom_scanner.storage.metadata import build_metadata_json, pin_launch_metadata
from axiom_scanner.storage.pinata import MetadataError, gateway_uri, validate_cid
from vercel_api.dispatch import handle_api_get, handle_api_post
from vercel_api.routes.launch import NAME_CHECK_NOTICE, NAME_CHECK_UNAVAILABLE, name_check_route
from vercel_api.routes.metadata import metadata_pin_route, reset_pin_limits


def _png(width: int = 200, height: int = 300, color: tuple[int, int, int] = (12, 80, 40)) -> bytes:
    buffer = BytesIO()
    Image.new("RGB", (width, height), color).save(buffer, format="PNG")
    return buffer.getvalue()


def _jpeg(width: int = 200, height: int = 300) -> bytes:
    buffer = BytesIO()
    Image.new("RGB", (width, height), (90, 20, 20)).save(buffer, format="JPEG")
    return buffer.getvalue()


class FakePinner:
    def __init__(self, cids: list[str] | None = None, error: Exception | None = None) -> None:
        self.calls: list[tuple[str, str]] = []
        self.cids = list(
            cids
            or [
                "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi",
                "bafybeihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku",
            ]
        )
        self.error = error

    def pin_file(self, data: bytes, filename: str, content_type: str) -> str:
        del data
        if self.error:
            raise self.error
        self.calls.append((filename, content_type))
        if not self.cids:
            raise MetadataError("Pinata returned an unusable CID.", "METADATA_PIN_FAILED")
        return self.cids.pop(0)


class FieldValidationTests(unittest.TestCase):
    def test_one_and_six_character_tickers(self) -> None:
        self.assertEqual(require_ticker("a"), "A")
        self.assertEqual(require_ticker("bonk42"), "BONK42")

    def test_invalid_social_urls(self) -> None:
        with self.assertRaises(FieldError):
            require_optional_twitter("http://x.com/mixborn")
        with self.assertRaises(FieldError):
            require_optional_twitter("https://evil.example/x")
        with self.assertRaises(FieldError):
            require_optional_telegram("https://telegram.org/mixborn")
        with self.assertRaises(FieldError):
            require_optional_website("https://user:pass@example.com")
        with self.assertRaises(FieldError):
            require_optional_website("http://example.com")

    def test_valid_socials_and_zero_buy(self) -> None:
        self.assertEqual(require_optional_twitter("https://x.com/mixborn"), "https://x.com/mixborn")
        self.assertEqual(require_optional_telegram("https://t.me/mixborn"), "https://t.me/mixborn")
        self.assertEqual(require_optional_website("https://mixborn.example"), "https://mixborn.example")
        self.assertEqual(require_initial_buy("0"), "0")
        self.assertEqual(require_initial_buy(""), "0")


class ImageEncodeTests(unittest.TestCase):
    def test_reencode_is_1024_png(self) -> None:
        png, digest = encode_launch_avatar(_jpeg())
        self.assertTrue(png.startswith(b"\x89PNG"))
        with Image.open(BytesIO(png)) as image:
            self.assertEqual(image.size, (1024, 1024))
            self.assertEqual(image.mode, "RGB")
        self.assertEqual(digest, hashlib.sha256(png).hexdigest())


class GatewayTests(unittest.TestCase):
    def test_cid_is_identity_and_https_only(self) -> None:
        cid = "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG"
        uri = gateway_uri(cid, "gateway.pinata.cloud")
        self.assertTrue(uri.startswith("https://gateway.pinata.cloud/ipfs/"))
        self.assertTrue(uri.endswith(cid))
        with self.assertRaises(MetadataError):
            gateway_uri(cid, "javascript:alert(1)")
        with self.assertRaises(MetadataError):
            gateway_uri(cid, "http://gateway.pinata.cloud/ipfs")

    def test_uri_too_long(self) -> None:
        cid = "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi"
        gateway = "https://" + ("g" * 170) + ".example.com/ipfs"
        with self.assertRaises(MetadataError) as raised:
            gateway_uri(cid, gateway)
        self.assertEqual(raised.exception.code, "METADATA_URI_TOO_LONG")

    def test_default_gateway_is_not_ipfs_io(self) -> None:
        from axiom_scanner.storage import pinata

        self.assertNotIn("ipfs.io", pinata.DEFAULT_GATEWAY)
        self.assertTrue(pinata.DEFAULT_GATEWAY.startswith("https://"))


class MetadataPinTests(unittest.TestCase):
    def setUp(self) -> None:
        reset_pin_limits()
        os.environ.pop("PINATA_JWT", None)

    def test_pin_image_then_json(self) -> None:
        pinner = FakePinner()
        result = pin_launch_metadata(
            image_bytes=_png(),
            fields={
                "name": "Test Token",
                "ticker": "TST",
                "description": "A token born on MIXBORN.",
                "twitter": "https://x.com/mixborn",
                "initial_buy_sol": "0",
            },
            pinner=pinner,
            gateway="https://gateway.pinata.cloud/ipfs",
        )
        self.assertEqual([call[0] for call in pinner.calls], ["avatar.png", "metadata.json"])
        self.assertEqual(pinner.calls[0][1], "image/png")
        self.assertEqual(pinner.calls[1][1], "application/json")
        self.assertTrue(result["metadata_uri"].startswith("https://"))
        self.assertLessEqual(len(result["metadata_uri"]), 200)
        self.assertNotIn("PINATA_JWT", json.dumps(result))
        self.assertNotIn("jwt", json.dumps(result).lower())

    def test_public_metadata_omits_private_fields(self) -> None:
        payload = build_metadata_json(
            name="Test Token",
            ticker="TST",
            description="hello",
            image_uri="https://gateway.pinata.cloud/ipfs/QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG",
            generated=True,
            parent_a_mint="0x0000000000000000000000000000000000001111",
        )
        dumped = json.dumps(payload)
        self.assertNotIn("prompt", dumped)
        self.assertNotIn("job_id", dumped)
        self.assertNotIn("signature", dumped)
        self.assertNotIn("score", dumped)
        self.assertTrue(payload["mixborn"]["generated"])
        self.assertEqual(payload["mixborn"]["version"], 1)

    def test_pinata_timeout(self) -> None:
        pinner = FakePinner(error=MetadataError("Pinata timed out.", "METADATA_TIMEOUT"))
        with self.assertRaises(MetadataError) as raised:
            pin_launch_metadata(
                image_bytes=_png(),
                fields={"name": "Test Token", "ticker": "TST", "description": "A token born on MIXBORN."},
                pinner=pinner,
            )
        self.assertEqual(raised.exception.code, "METADATA_TIMEOUT")

    def test_ipfs_error(self) -> None:
        pinner = FakePinner(error=MetadataError("Metadata pinning failed.", "METADATA_PIN_FAILED"))
        with self.assertRaises(MetadataError) as raised:
            pin_launch_metadata(
                image_bytes=_png(),
                fields={"name": "Test Token", "ticker": "TST", "description": "A token born on MIXBORN."},
                pinner=pinner,
            )
        self.assertEqual(raised.exception.code, "METADATA_PIN_FAILED")

    def test_missing_jwt_is_unavailable(self) -> None:
        avatar = HybridImage(field_name="avatar", filename="a.png", content_type="image/png", data=_png())
        with self.assertRaises(MetadataError) as raised:
            metadata_pin_route(
                {
                    "name": "Test Token",
                    "ticker": "TST",
                    "description": "A token born on MIXBORN.",
                    "rights_confirmed": "true",
                    "risk_confirmed": "true",
                },
                {"avatar": avatar},
                "9.9.9.9",
            )
        self.assertEqual(raised.exception.code, "METADATA_UNAVAILABLE")

    def test_route_requires_confirmations(self) -> None:
        avatar = HybridImage(field_name="avatar", filename="a.png", content_type="image/png", data=_png())
        with self.assertRaises(FieldError):
            metadata_pin_route(
                {"name": "Test Token", "ticker": "TST", "description": "A token born on MIXBORN."},
                {"avatar": avatar},
                "9.9.9.9",
                pinner=FakePinner(),
            )


class NameCheckTests(unittest.TestCase):
    def test_matches_are_informational(self) -> None:
        def search(query: str, limit: int, config):
            del limit, config
            if query == "BONK":
                return {"items": [{"name": "Bonk", "symbol": "BONK", "mint": "mint-1"}]}
            return {"items": [{"name": "Bonk", "symbol": "BONK", "mint": "mint-1"}]}

        result = name_check_route("Bonk", "BONK", config=object(), search=search)
        self.assertTrue(result["check_available"])
        self.assertGreaterEqual(result["name_matches"], 1)
        self.assertEqual(result["notice"], NAME_CHECK_NOTICE)
        self.assertNotIn("trademark", result["notice"].lower())
        self.assertNotIn("safety", result["notice"].lower())

    def test_unavailable_does_not_block(self) -> None:
        def search(query: str, limit: int, config):
            del query, limit, config
            raise RuntimeError("offline")

        result = name_check_route("Bonk", "BONK", config=object(), search=search)
        self.assertFalse(result["check_available"])
        self.assertEqual(result["notice"], NAME_CHECK_UNAVAILABLE)


class DispatchMetadataTests(unittest.TestCase):
    def test_pin_without_multipart(self) -> None:
        status, payload = handle_api_post("/api/metadata/pin", read_body=lambda max_bytes: {}, client_ip="1.1.1.1")
        self.assertEqual(status, 400)
        self.assertEqual(payload["error"]["code"], "INVALID_INPUT")

    def test_json_body_to_pin_is_invalid(self) -> None:
        from axiom_scanner.analysis.wavespeed_hybrid import HybridImageError

        def boom(max_bytes: int):
            del max_bytes
            raise HybridImageError("Expected multipart/form-data or application/json.", "bad_content_type")

        status, payload = handle_api_post("/api/metadata/pin", read_multipart=boom, client_ip="1.1.1.1")
        self.assertEqual(status, 400)
        self.assertEqual(payload["error"]["code"], "INVALID_INPUT")

    def test_name_check_endpoint_never_500s_on_search_failure(self) -> None:
        with patch("vercel_api.routes.launch.search_tokens", side_effect=RuntimeError("offline")):
            status, payload = handle_api_get("/api/launch/name-check", {"name": ["Bonk"], "ticker": ["BONK"]})
        self.assertEqual(status, 200)
        self.assertTrue(payload["success"])
        self.assertEqual(payload["data"]["notice"], NAME_CHECK_UNAVAILABLE)

    def test_jwt_not_in_pinata_module_public_flags(self) -> None:
        from axiom_scanner.storage import pinata

        source = inspect.getsource(pinata)
        self.assertNotIn("VITE_", source)
        self.assertNotIn("NEXT_PUBLIC_", source)

    def test_validate_cid_rejects_garbage(self) -> None:
        with self.assertRaises(MetadataError):
            validate_cid("not-a-cid")


if __name__ == "__main__":
    unittest.main()
