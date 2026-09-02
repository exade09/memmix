from __future__ import annotations

import time
from typing import Any, Protocol
from urllib.parse import quote_plus

from axiom_scanner.config import ScannerConfig
from axiom_scanner.http_client import HttpClient, SourceMalformed
from axiom_scanner.security.query import (
    collision_warning,
    parse_search_query,
    snapshot_to_summary,
)
from axiom_scanner.sources.dexscreener import DexScreenerSource, _pair_to_snapshot


class JsonGetter(Protocol):
    def get_json(self, url: str) -> Any: ...


def search_tokens(
    query: str,
    limit: int,
    config: ScannerConfig,
    *,
    http: JsonGetter | None = None,
) -> dict[str, object]:
    text, exact_mint = parse_search_query(query)
    client = http or HttpClient(timeout_seconds=min(config.request_timeout_seconds, 10), retries=1)
    now_ms = int(time.time() * 1000)
    by_mint: dict[str, dict[str, object]] = {}

    _ingest_pairs(client, f"{DexScreenerSource.BASE_URL}/latest/dex/search?q={quote_plus(text)}", now_ms, by_mint)
    if exact_mint:
        _ingest_token(client, exact_mint, now_ms, by_mint)

    items = list(by_mint.values())
    needle = text.lstrip("$")
    if exact_mint:
        items.sort(key=lambda item: (0 if str(item.get("mint", "")).lower() == exact_mint.lower() else 1, -_liq(item)))
    else:
        items.sort(
            key=lambda item: (
                0 if str(item.get("symbol", "")).upper().lstrip("$") == needle.upper() else 1,
                0 if str(item.get("name", "")).lower() == needle.lower() else 1,
                -_liq(item),
                -_vol(item),
            )
        )
    capped = items[: max(1, min(limit, 12))]
    return {
        "items": capped,
        "collision_warning": collision_warning(capped, needle),
    }


def _ingest_pairs(http: JsonGetter, url: str, now_ms: int, by_mint: dict[str, dict[str, object]]) -> None:
    try:
        payload = http.get_json(url)
    except SourceMalformed:
        return
    pairs = payload.get("pairs", []) if isinstance(payload, dict) else payload
    if not isinstance(pairs, list):
        return
    for pair in pairs:
        if not isinstance(pair, dict):
            continue
        if str(pair.get("chainId", "")).lower() != "robinhood":
            continue
        snapshot = _pair_to_snapshot(pair, now_ms=now_ms)
        if not snapshot.token_address:
            continue
        summary = snapshot_to_summary(snapshot)
        mint = str(summary["mint"]).lower()
        existing = by_mint.get(mint)
        if existing is None or _liq(summary) > _liq(existing):
            by_mint[mint] = summary


def _ingest_token(http: JsonGetter, mint: str, now_ms: int, by_mint: dict[str, dict[str, object]]) -> None:
    url = f"{DexScreenerSource.BASE_URL}/tokens/v1/robinhood/{mint}"
    try:
        payload = http.get_json(url)
    except RuntimeError:
        return
    pairs = payload if isinstance(payload, list) else payload.get("pairs", []) if isinstance(payload, dict) else []
    if not isinstance(pairs, list):
        return
    for pair in pairs:
        if isinstance(pair, dict):
            pair.setdefault("chainId", "robinhood")
            _ingest_pairs_list([pair], now_ms, by_mint)


def _ingest_pairs_list(pairs: list[dict[str, Any]], now_ms: int, by_mint: dict[str, dict[str, object]]) -> None:
    for pair in pairs:
        if str(pair.get("chainId", "")).lower() != "robinhood":
            continue
        snapshot = _pair_to_snapshot(pair, now_ms=now_ms)
        if not snapshot.token_address:
            continue
        summary = snapshot_to_summary(snapshot)
        mint = str(summary["mint"]).lower()
        existing = by_mint.get(mint)
        if existing is None or _liq(summary) > _liq(existing):
            by_mint[mint] = summary


def _liq(item: dict[str, object]) -> float:
    value = item.get("liquidity_usd")
    try:
        return float(value) if value is not None else 0.0
    except (TypeError, ValueError):
        return 0.0


def _vol(item: dict[str, object]) -> float:
    value = item.get("volume_24h_usd")
    try:
        return float(value) if value is not None else 0.0
    except (TypeError, ValueError):
        return 0.0
