from __future__ import annotations

import json
import os
import sys
import time
from http.server import BaseHTTPRequestHandler
from pathlib import Path
from typing import Any


PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "web"

if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from axiom_scanner.analysis.image_generation import ImageGenerationError, generate_meme_image
from axiom_scanner.analysis.narratives import generate_narratives, load_og_memecoins, normalize_og_memecoins
from axiom_scanner.analysis.wavespeed_hybrid import (
    HybridImageError,
    MAX_REQUEST_BYTES as MAX_HYBRID_REQUEST_BYTES,
    generate_hybrid_image_request,
    parse_multipart,
)
from axiom_scanner.config import ScannerConfig, load_config
from axiom_scanner.pipeline import scan_once, resolve_cached_token_image


from vercel_api.security_headers import apply_security_headers


ALLOWED_CHAINS = ["solana"]


def configure_runtime() -> None:
    os.environ.setdefault("AXIOM_LOG_DIR", "/tmp/axiom-ai-scanner-logs")


def runtime_config() -> ScannerConfig:
    configure_runtime()
    return apply_cli_overrides(load_config(None), None)


def apply_cli_overrides(config: ScannerConfig, chains: list[str] | None) -> ScannerConfig:
    config.chains = ALLOWED_CHAINS.copy()
    return config


def send_json(handler: BaseHTTPRequestHandler, payload: dict[str, Any] | list[Any], status: int = 200) -> None:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Cache-Control", "no-store")
    apply_security_headers(handler)
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def client_ip(handler: BaseHTTPRequestHandler) -> str:
    forwarded = handler.headers.get("X-Forwarded-For", "")
    if forwarded:
        return forwarded.split(",", 1)[0].strip()
    return handler.client_address[0] if handler.client_address else "unknown"


def read_json_body(handler: BaseHTTPRequestHandler, max_bytes: int = 512_000) -> dict[str, Any] | list[Any]:
    try:
        content_length = max(int(handler.headers.get("Content-Length", "0")), 0)
    except ValueError:
        content_length = 0
    if content_length > max_bytes:
        raise ValueError("payload too large")
    body = handler.rfile.read(content_length)
    payload = json.loads(body.decode("utf-8") or "{}")
    if not isinstance(payload, (dict, list)):
        raise ValueError("Request body must be JSON.")
    return payload


def scan_payload(limit: int) -> dict[str, Any]:
    config = runtime_config()
    data_source = "dexscreener"
    try:
        rows = scan_once(config, limit=limit)
    except RuntimeError as exc:
        data_source = "local-fallback"
        rows = fallback_scan_rows(limit=limit)
        fallback_error = str(exc)
    else:
        fallback_error = ""

    og_memecoins = load_og_memecoins(PROJECT_ROOT, config.og_memecoins_path)
    return {
        "updated_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "count": len(rows),
        "min_market_cap_usd": config.min_market_cap_usd,
        "tokens": rows,
        "og_memecoins": og_memecoins,
        "narratives": generate_narratives(rows, og_memecoins, limit=12),
        "data_source": data_source,
        "fallback_error": fallback_error,
    }


def fallback_scan_rows(limit: int) -> list[dict[str, Any]]:
    og_memecoins = load_og_memecoins(PROJECT_ROOT, "data/og_memecoins.json")
    rows = []
    for index, item in enumerate(og_memecoins[:limit], start=1):
        symbol = str(item.get("symbol") or "").strip()
        image_path = PROJECT_ROOT / "web" / "assets" / "tokens" / f"{symbol}.svg"
        public_image = f"/assets/tokens/{symbol}.svg" if image_path.is_file() else ""
        rows.append(
            {
                "rank": index,
                "token": symbol,
                "name": item.get("name") or symbol,
                "chain": "solana",
                "address": "",
                "image_url": public_image,
                "score": None,
                "signal": None,
                "price_usd": None,
                "market_cap": None,
                "fdv": None,
                "liquidity_usd": None,
                "volume_1h": None,
                "volume_24h": None,
                "txns_1h": None,
                "buys_1h": None,
                "sells_1h": None,
                "price_change_5m": None,
                "price_change_1h": None,
                "price_change_6h": None,
                "price_change_24h": None,
                "age_minutes": None,
                "risk_flags": ["cached_example"],
                "why": "Cached example. Not live market data.",
                "url": "",
            }
        )
    return rows


def _parse_int(value: str, fallback: int) -> int:
    try:
        return max(int(value), 1)
    except ValueError:
        return fallback


def _parse_content_length(value: str) -> int:
    try:
        return max(int(value), 0)
    except ValueError:
        return 0


def _resolve_og_image(config: ScannerConfig, name: str, symbol: str) -> str:
    return _resolve_token_image(config, name=name, symbol=symbol)


def _resolve_token_image(config: ScannerConfig, name: str, symbol: str) -> str:
    return resolve_cached_token_image(config, name=name, symbol=symbol)
