from __future__ import annotations

import json
import os
import unittest
from unittest.mock import patch
from urllib.error import HTTPError

from vercel_api.dispatch import handle_api_get, handle_api_post
from vercel_api.routes.ca import CA_FILE, CaError, reset_ca_rate_limit, read_ca, update_ca


class CaTests(unittest.TestCase):
    def setUp(self) -> None:
        reset_ca_rate_limit()
        self._original = CA_FILE.read_text(encoding="utf-8") if CA_FILE.exists() else None
        os.environ["ADMIN_CA_PASSWORD"] = "unit-test-password"
        os.environ.pop("GITHUB_TOKEN", None)
        os.environ.pop("VERCEL", None)
        os.environ.pop("VERCEL_ENV", None)

    def tearDown(self) -> None:
        if self._original is not None:
            CA_FILE.write_text(self._original, encoding="utf-8")
        os.environ.pop("ADMIN_CA_PASSWORD", None)
        os.environ.pop("GITHUB_TOKEN", None)
        os.environ.pop("VERCEL", None)
        os.environ.pop("VERCEL_ENV", None)

    def test_get_reads_the_bundled_file(self) -> None:
        CA_FILE.write_text(json.dumps({"ca": "0xabc", "updated_at": "2026-01-01T00:00:00Z"}), encoding="utf-8")
        self.assertEqual(read_ca(), {"ca": "0xabc", "updated_at": "2026-01-01T00:00:00Z"})

    def test_missing_or_corrupt_file_reads_as_empty(self) -> None:
        CA_FILE.write_text("not json", encoding="utf-8")
        self.assertEqual(read_ca(), {"ca": "", "updated_at": None})

    def test_wrong_password_is_rejected(self) -> None:
        with self.assertRaises(CaError) as ctx:
            update_ca(password="nope", ca="0xabc", client_ip="1.1.1.1")
        self.assertEqual(ctx.exception.code, "WRONG_PASSWORD")

    def test_empty_password_is_rejected_not_treated_as_unset(self) -> None:
        with self.assertRaises(CaError) as ctx:
            update_ca(password="", ca="0xabc", client_ip="1.1.1.1")
        self.assertEqual(ctx.exception.code, "WRONG_PASSWORD")

    def test_no_password_configured_refuses_every_attempt(self) -> None:
        os.environ.pop("ADMIN_CA_PASSWORD", None)
        with self.assertRaises(CaError) as ctx:
            update_ca(password="unit-test-password", ca="0xabc", client_ip="1.1.1.1")
        self.assertEqual(ctx.exception.code, "ADMIN_DISABLED")

    def test_correct_password_writes_locally_without_github(self) -> None:
        result = update_ca(password="unit-test-password", ca="0xABCDEF", client_ip="2.2.2.2")
        self.assertEqual(result["ca"], "0xABCDEF")
        self.assertEqual(result["live_in_seconds"], 0)
        self.assertEqual(read_ca()["ca"], "0xABCDEF")

    def test_whitespace_is_collapsed_and_trimmed(self) -> None:
        result = update_ca(password="unit-test-password", ca="  0x1234   5678  ", client_ip="2.2.2.2")
        self.assertEqual(result["ca"], "0x1234 5678")

    def test_overlong_value_is_rejected(self) -> None:
        with self.assertRaises(CaError) as ctx:
            update_ca(password="unit-test-password", ca="0x" + "a" * 300, client_ip="2.2.2.2")
        self.assertEqual(ctx.exception.code, "TOO_LONG")

    def test_ordinary_placeholders_are_never_treated_as_a_format_error(self) -> None:
        # No whitelist on shape: "TBA", a note, a link, whatever the header
        # needs to say before a real address exists all save the same way.
        for value in ("TBA", "tba soon", "https://x.com/fonsfamily", "coming at launch"):
            with self.subTest(value=value):
                result = update_ca(password="unit-test-password", ca=value, client_ip="2.2.2.2")
                self.assertEqual(result["ca"], value)

    def test_rate_limit_stops_password_guessing(self) -> None:
        for _ in range(8):
            with self.assertRaises(CaError):
                update_ca(password="wrong", ca="0xabc", client_ip="3.3.3.3")
        with self.assertRaises(CaError) as ctx:
            update_ca(password="unit-test-password", ca="0xabc", client_ip="3.3.3.3")
        self.assertEqual(ctx.exception.code, "RATE_LIMITED")

    def test_rate_limit_is_per_ip(self) -> None:
        for _ in range(8):
            with self.assertRaises(CaError):
                update_ca(password="wrong", ca="0xabc", client_ip="4.4.4.4")
        # A different caller is not punished for someone else's failed guesses.
        result = update_ca(password="unit-test-password", ca="0xdef", client_ip="5.5.5.5")
        self.assertEqual(result["ca"], "0xdef")

    def test_production_without_a_github_token_fails_honestly(self) -> None:
        os.environ["VERCEL_ENV"] = "production"
        with self.assertRaises(CaError) as ctx:
            update_ca(password="unit-test-password", ca="0xabc", client_ip="6.6.6.6")
        self.assertEqual(ctx.exception.code, "DEPLOY_UNAVAILABLE")

    def test_production_writes_through_github_not_the_filesystem(self) -> None:
        os.environ["VERCEL_ENV"] = "production"
        os.environ["GITHUB_TOKEN"] = "gh-test-token"
        before = CA_FILE.read_text(encoding="utf-8")

        calls = []

        class FakeResponse:
            def __init__(self, body: bytes) -> None:
                self._body = body

            def read(self) -> bytes:
                return self._body

            def __enter__(self):
                return self

            def __exit__(self, *args):
                return False

        def fake_urlopen(request, timeout=None):
            calls.append((request.get_method() or "GET", request.full_url))
            if request.get_method() in (None, "GET"):
                return FakeResponse(json.dumps({"sha": "abc123"}).encode("utf-8"))
            return FakeResponse(b"{}")

        with patch("vercel_api.routes.ca.urlopen", side_effect=fake_urlopen):
            result = update_ca(password="unit-test-password", ca="0xnew", client_ip="7.7.7.7")

        self.assertEqual(result["ca"], "0xnew")
        self.assertEqual(result["live_in_seconds"], 60)
        # The local file must not have been touched: production state lives in
        # the deployed bundle produced by the commit, not on this filesystem.
        self.assertEqual(CA_FILE.read_text(encoding="utf-8"), before)
        methods = [m for m, _ in calls]
        self.assertIn("GET", methods)
        self.assertIn("PUT", methods)

    def test_github_failure_is_reported_not_swallowed(self) -> None:
        os.environ["VERCEL_ENV"] = "production"
        os.environ["GITHUB_TOKEN"] = "gh-test-token"

        def fake_urlopen(request, timeout=None):
            raise HTTPError(request.full_url, 500, "boom", hdrs=None, fp=None)

        with patch("vercel_api.routes.ca.urlopen", side_effect=fake_urlopen):
            with self.assertRaises(CaError) as ctx:
                update_ca(password="unit-test-password", ca="0xnew", client_ip="8.8.8.8")
        self.assertEqual(ctx.exception.code, "DEPLOY_UNAVAILABLE")

    def test_password_never_appears_in_any_response(self) -> None:
        _, get_body = handle_api_get("/api/ca", {})
        self.assertNotIn("unit-test-password", json.dumps(get_body))

        _, post_body = handle_api_post(
            "/api/admin/ca",
            read_json=lambda max_bytes: {"password": "unit-test-password", "ca": "0xsafe"},
            client_ip="9.9.9.9",
        )
        self.assertNotIn("unit-test-password", json.dumps(post_body))

    def test_dispatch_rejects_non_json_body(self) -> None:
        def broken_reader(max_bytes):
            raise ValueError("not json")

        status, body = handle_api_post("/api/admin/ca", read_json=broken_reader, client_ip="1.1.1.1")
        self.assertEqual(status, 400)
        self.assertEqual(body["error"]["code"], "INVALID_INPUT")


if __name__ == "__main__":
    unittest.main()
