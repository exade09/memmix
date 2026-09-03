from __future__ import annotations

import json
import mimetypes
from http.server import BaseHTTPRequestHandler
from urllib.parse import parse_qs, urlparse

from vercel_api.dispatch import handle_api_get, handle_api_post
from vercel_api.security_headers import apply_security_headers
from vercel_api.shared import (
    MAX_HYBRID_REQUEST_BYTES,
    content_type_for,
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
    parse_multipart,
    read_json_body,
    runtime_config,
    scan_payload,
    send_json,
    client_ip,
)


class handler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/"):
            routed = handle_api_get(parsed.path, parsed.query)
            if routed is not None:
                status, payload = routed
                send_json(self, payload, status=status)
                return

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

        self._send_static(parsed.path)

    def do_POST(self) -> None:
        parsed = urlparse(self.path)

        def _read_multipart(max_bytes: int):
            content_type = self.headers.get("Content-Type", "")
            content_length = _parse_content_length(self.headers.get("Content-Length", "0"))
            if content_length <= 0:
                raise ValueError("empty multipart")
            if content_length > max_bytes:
                raise ValueError("multipart too large")
            body = self.rfile.read(content_length)
            return parse_multipart(content_type, body)

        routed = handle_api_post(
            parsed.path,
            read_body=lambda max_bytes: read_json_body(self, max_bytes=max_bytes),
            read_multipart=_read_multipart,
            client_ip=client_ip(self),
            origin=self.headers.get("Origin", ""),
            host=self.headers.get("Host", ""),
        )
        if routed is not None:
            status, payload = routed
            send_json(self, payload, status=status)
            return
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

    def _send_static(self, request_path: str) -> None:
        if request_path in {"/app.js", "/styles.css"}:
            send_json(self, {"error": "Not found"}, status=404)
            return
        static_path = self._static_path_for_request(request_path)
        full_path = static_path.resolve()
        web_root = WEB_ROOT.resolve()
        if not str(full_path).startswith(str(web_root)) or not full_path.is_file():
            send_json(self, {"error": "Not found"}, status=404)
            return

        body = full_path.read_bytes()
        content_type = content_type_for(full_path)
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        apply_security_headers(self)
        if request_path.startswith("/assets/"):
            self.send_header("Cache-Control", "public, max-age=31536000, immutable")
        else:
            self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _static_path_for_request(self, request_path: str):
        """
        File existence decides what gets served, not the shape of the path.

        The previous version only let /assets/* and /favicon.svg reach their
        own file; every other path - /favicon.png, /favicon-180.png,
        /apple-touch-icon.png, anything else Vite drops at the root of dist/ -
        silently fell through to the SPA's index.html. That is not a 404: it
        is a 200 with the wrong body, wrong content type, and no error to
        notice. It is how the favicon spent this whole session being served
        as HTML.
        """
        dist_root = WEB_ROOT / "dist"
        index_html = dist_root / "index.html" if (dist_root / "index.html").is_file() else WEB_ROOT / "index.html"
        if request_path in {"", "/"}:
            return index_html

        rel = request_path.lstrip("/")
        dist_file = dist_root / rel
        if dist_file.is_file():
            return dist_file
        public_file = WEB_ROOT / "public" / rel
        if public_file.is_file():
            return public_file

        # A path with a file extension that matched nothing on disk is a
        # missing asset, not a client-side route: it must 404, never fall
        # back to index.html and hide the miss behind a 200.
        if "." in request_path.rsplit("/", 1)[-1]:
            return dist_root / "__missing__" / rel

        # No extension: this is an SPA route (/app/mix, /docs, /token/0x...),
        # so the client-side router gets index.html and takes it from there.
        return index_html

    def log_message(self, format: str, *args: object) -> None:
        return
