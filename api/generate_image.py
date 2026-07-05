from __future__ import annotations

import json
from http.server import BaseHTTPRequestHandler

from vercel_api.shared import ImageGenerationError, _resolve_og_image, generate_meme_image, read_json_body, runtime_config, send_json


class handler(BaseHTTPRequestHandler):
    def do_POST(self) -> None:
        try:
            payload = read_json_body(self, max_bytes=512_000)
            config = runtime_config()
            result = generate_meme_image(
                payload,
                resolve_og_image=lambda name, symbol: _resolve_og_image(config, name=name, symbol=symbol),
            )
            send_json(self, result)
        except ImageGenerationError as exc:
            send_json(self, {"error": str(exc), "code": exc.code}, status=exc.status)
        except (json.JSONDecodeError, ValueError, TypeError) as exc:
            send_json(self, {"error": str(exc), "code": "bad_request"}, status=400)

    def log_message(self, format: str, *args: object) -> None:
        return

