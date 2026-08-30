from __future__ import annotations

import json
import unittest
from io import BytesIO

from vercel_api.security_headers import SECURITY_HEADERS, apply_security_headers
from vercel_api.shared import send_json


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
