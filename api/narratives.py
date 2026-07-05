from __future__ import annotations

import json
from http.server import BaseHTTPRequestHandler

from vercel_api.shared import _parse_int, generate_narratives, normalize_og_memecoins, read_json_body, send_json


class handler(BaseHTTPRequestHandler):
    def do_POST(self) -> None:
        try:
            payload = read_json_body(self, max_bytes=256_000)
            tokens = payload.get("tokens", [])
            if not isinstance(tokens, list):
                raise ValueError("tokens must be a list")
            og_memecoins = normalize_og_memecoins(payload.get("og_memecoins", []))
            limit = _parse_int(str(payload.get("limit", "12")), 12)
            send_json(self, {"narratives": generate_narratives(tokens, og_memecoins, limit=limit)})
        except (json.JSONDecodeError, ValueError) as exc:
            send_json(self, {"error": str(exc)}, status=400)

    def log_message(self, format: str, *args: object) -> None:
        return

