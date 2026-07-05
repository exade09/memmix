from __future__ import annotations

from http.server import BaseHTTPRequestHandler

from vercel_api.shared import PROJECT_ROOT, load_og_memecoins, runtime_config, send_json


class handler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        config = runtime_config()
        send_json(self, {"og_memecoins": load_og_memecoins(PROJECT_ROOT, config.og_memecoins_path)})

    def log_message(self, format: str, *args: object) -> None:
        return

