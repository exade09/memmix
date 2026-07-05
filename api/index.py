from __future__ import annotations

import json
from http.server import BaseHTTPRequestHandler
from urllib.parse import parse_qs, urlparse

from vercel_api.shared import (
    MAX_HYBRID_REQUEST_BYTES,
    PROJECT_ROOT,
    WEB_ROOT,
    HybridImageError,
    ImageGenerationError,
    _parse_content_length,
    _parse_int,
    _resolve_og_image,
    generate_hybrid_image_request,
    generate_meme_image,
    generate_narratives,
    load_og_memecoins,
    normalize_og_memecoins,
    read_json_body,
    runtime_config,
    scan_payload,
    send_json,
)


class handler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/api/scan":
            params = parse_qs(parsed.query)
            limit = _parse_int(params.get("limit", ["100"])[0], 100)
            send_json(self, scan_payload(limit=limit))
            return

        if parsed.path == "/api/og":
            config = runtime_config()
            send_json(self, {"og_memecoins": load_og_memecoins(PROJECT_ROOT, config.og_memecoins_path)})
            return

        if parsed.path == "/api/og-image":
            params = parse_qs(parsed.query)
            name = params.get("name", [""])[0]
            symbol = params.get("symbol", [""])[0]
            image_url = _resolve_og_image(runtime_config(), name=name, symbol=symbol)
            send_json(self, {"name": name, "symbol": symbol, "image_url": image_url})
            return

        send_json(self, {"error": "Not found"}, status=404)

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/api/narratives":
            self._send_narratives()
            return

        if parsed.path == "/api/generate-image":
            self._send_generated_image()
            return

        if parsed.path == "/api/hybrid-image":
            self._send_hybrid_image()
            return

        send_json(self, {"error": "Not found"}, status=404)

    def _send_narratives(self) -> None:
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

    def _send_generated_image(self) -> None:
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

    def _send_hybrid_image(self) -> None:
        try:
            content_length = _parse_content_length(self.headers.get("Content-Length", "0"))
            if content_length <= 0:
                raise HybridImageError("Request body is empty.", "empty_body")
            if content_length > min(MAX_HYBRID_REQUEST_BYTES, 4_500_000):
                raise HybridImageError(
                    "Request is too large for the Vercel function limit. Try smaller images.",
                    code="request_too_large",
                    status=413,
                )

            body = self.rfile.read(content_length)
            result = generate_hybrid_image_request(self.headers.get("Content-Type", ""), body, WEB_ROOT)
            send_json(self, result)
        except HybridImageError as exc:
            send_json(self, {"error": str(exc), "code": exc.code}, status=exc.status)
        except (ValueError, TypeError) as exc:
            send_json(self, {"error": str(exc), "code": "bad_request"}, status=400)

    def log_message(self, format: str, *args: object) -> None:
        return
