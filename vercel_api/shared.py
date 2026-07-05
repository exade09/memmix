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
)
from axiom_scanner.config import ScannerConfig, load_config
from main import apply_cli_overrides, scan_once, _parse_content_length, _parse_int, _resolve_og_image


def configure_runtime() -> None:
    os.environ.setdefault("AXIOM_LOG_DIR", "/tmp/axiom-ai-scanner-logs")


def runtime_config() -> ScannerConfig:
    configure_runtime()
    return apply_cli_overrides(load_config(None), None)


def send_json(handler: BaseHTTPRequestHandler, payload: dict[str, Any], status: int = 200) -> None:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Cache-Control", "no-store")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def read_json_body(handler: BaseHTTPRequestHandler, max_bytes: int = 512_000) -> dict[str, Any]:
    try:
        content_length = max(int(handler.headers.get("Content-Length", "0")), 0)
    except ValueError:
        content_length = 0
    body = handler.rfile.read(min(content_length, max_bytes))
    payload = json.loads(body.decode("utf-8") or "{}")
    if not isinstance(payload, dict):
        raise ValueError("Request body must be a JSON object.")
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
    path = PROJECT_ROOT / "data" / "solana_memecoins.json"
    payload = json.loads(path.read_text(encoding="utf-8"))
    rows = []
    for index, item in enumerate(payload.get("tokens", [])[:limit], start=1):
        symbol = str(item.get("symbol") or "").strip()
        theme = str(item.get("theme") or "meme").strip()
        rows.append(
            {
                "rank": index,
                "token": symbol,
                "name": item.get("name") or symbol,
                "chain": "solana",
                "address": f"So111111111111111111111111111111111111{index:04d}",
                "image_url": f"/assets/tokens/{symbol}.svg",
                "score": float(item.get("score") or 0),
                "signal": item.get("signal") or "SPECULATIVE",
                "price_usd": 0,
                "market_cap": item.get("market_cap") or 0,
                "fdv": item.get("market_cap") or 0,
                "liquidity_usd": item.get("liquidity") or 0,
                "volume_1h": item.get("volume") or 0,
                "volume_24h": float(item.get("volume") or 0) * 7.4,
                "txns_1h": item.get("txns") or 0,
                "buys_1h": round(float(item.get("txns") or 0) * 0.58),
                "sells_1h": round(float(item.get("txns") or 0) * 0.42),
                "price_change_5m": round(float(item.get("change") or 0) / 4, 2),
                "price_change_1h": item.get("change") or 0,
                "price_change_6h": round(float(item.get("change") or 0) * 1.9, 2),
                "price_change_24h": round(float(item.get("change") or 0) * 3.1, 2),
                "age_minutes": item.get("age") or 0,
                "risk_flags": ["local fallback data", "verify contract before trading"],
                "why": f"{theme} momentum on Solana meme watchlist. Vercel fallback entry with bundled image asset.",
                "url": f"https://dexscreener.com/solana/{symbol}",
            }
        )
    return rows
