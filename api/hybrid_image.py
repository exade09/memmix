from __future__ import annotations

from http.server import BaseHTTPRequestHandler

from vercel_api.shared import (
    MAX_HYBRID_REQUEST_BYTES,
    HybridImageError,
    WEB_ROOT,
    _parse_content_length,
    generate_hybrid_image_request,
    send_json,
)


class handler(BaseHTTPRequestHandler):
    def do_POST(self) -> None:
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

