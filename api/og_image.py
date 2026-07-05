from __future__ import annotations

from http.server import BaseHTTPRequestHandler
from urllib.parse import parse_qs, urlparse

from vercel_api.shared import _resolve_og_image, runtime_config, send_json


class handler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        params = parse_qs(urlparse(self.path).query)
        name = params.get("name", [""])[0]
        symbol = params.get("symbol", [""])[0]
        image_url = _resolve_og_image(runtime_config(), name=name, symbol=symbol)
        send_json(self, {"name": name, "symbol": symbol, "image_url": image_url})

    def log_message(self, format: str, *args: object) -> None:
        return

