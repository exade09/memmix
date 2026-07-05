from __future__ import annotations

from http.server import BaseHTTPRequestHandler
from urllib.parse import parse_qs, urlparse

from vercel_api.shared import _parse_int, scan_payload, send_json


class handler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        params = parse_qs(urlparse(self.path).query)
        limit = _parse_int(params.get("limit", ["100"])[0], 100)
        send_json(self, scan_payload(limit=limit))

    def log_message(self, format: str, *args: object) -> None:
        return

