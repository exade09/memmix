from __future__ import annotations

import json
import unittest
from io import BytesIO

from vercel_api.security_headers import SECURITY_HEADERS, apply_security_headers
from vercel_api.shared import content_type_for, send_json


class DummyHandler:
    def __init__(self) -> None:
        self.status = None
        self.headers: list[tuple[str, str]] = []
        self.wfile = BytesIO()

    def send_response(self, status: int) -> None:
        self.status = status

    def send_header(self, key: str, value: str) -> None:
        self.headers.append((key, value))

    def end_headers(self) -> None:
        return None


class SecurityHeaderTests(unittest.TestCase):
    def test_json_responses_include_csp_and_frame_deny(self) -> None:
        handler = DummyHandler()
        send_json(handler, {"success": True, "data": {"ok": True}}, status=200)
        sent = dict(handler.headers)
        self.assertEqual(handler.status, 200)
        self.assertEqual(sent["X-Content-Type-Options"], "nosniff")
        self.assertEqual(sent["X-Frame-Options"], "DENY")
        self.assertEqual(sent["Referrer-Policy"], "strict-origin-when-cross-origin")
        self.assertIn("camera=()", sent["Permissions-Policy"])
        csp = sent["Content-Security-Policy"]
        self.assertIn("default-src 'self'", csp)
        self.assertNotIn("unsafe-eval", csp)
        self.assertIn("frame-ancestors 'none'", csp)
        body = json.loads(handler.wfile.getvalue().decode("utf-8"))
        self.assertTrue(body["success"])

    def test_header_helper_matches_vercel_map(self) -> None:
        handler = DummyHandler()
        apply_security_headers(handler)
        self.assertEqual(dict(handler.headers), SECURITY_HEADERS)


class StaticContentTypeTests(unittest.TestCase):
    """
    We send X-Content-Type-Options: nosniff, so a wrong type is not something a
    browser will quietly correct. The runtime's mime registry knew neither .webp
    nor .woff2 and served both as application/octet-stream.
    """

    def test_shipped_asset_types_are_declared_not_guessed(self) -> None:
        expected = {
            "brand/fons-mark.webp": "image/webp",
            "geist-latin-wght-normal.woff2": "font/woff2",
            "index.js": "text/javascript; charset=utf-8",
            "index.css": "text/css; charset=utf-8",
            "favicon.png": "image/png",
            "token-fallback.webp": "image/webp",
        }
        for name, want in expected.items():
            with self.subTest(name=name):
                self.assertEqual(content_type_for(name), want)

    def test_extension_case_is_ignored(self) -> None:
        self.assertEqual(content_type_for("LOGO.WEBP"), "image/webp")

    def test_unknown_extension_falls_back_to_bytes(self) -> None:
        self.assertEqual(content_type_for("archive.unknownext"), "application/octet-stream")
