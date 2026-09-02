from __future__ import annotations

from typing import Any

from axiom_scanner.analysis.local_ai import explain_ranked_tokens
from axiom_scanner.analysis.scoring import rank_tokens
from axiom_scanner.config import ScannerConfig
from axiom_scanner.sources.dexscreener import DexScreenerSource, resolve_token_image


_IMAGE_CACHE: dict[str, str] = {}


def scan_once(config: ScannerConfig, limit: int, *, resolve_images: bool = True) -> list[dict[str, Any]]:
    source = DexScreenerSource(config=config)
    snapshots = source.fetch_tokens()
    ranked = rank_tokens(snapshots, config=config)
    visible_ranked = [item for item in ranked if item.snapshot.chain_id.lower() == "robinhood"]

    selected_items = []
    for item in visible_ranked:
        if len(selected_items) >= limit:
            break
        if resolve_images and not item.snapshot.image_url:
            item.snapshot.image_url = resolve_cached_token_image(
                config,
                name=item.snapshot.name,
                symbol=item.snapshot.symbol,
            )
        selected_items.append(item)

    rows: list[dict[str, Any]] = []
    explanations = explain_ranked_tokens(selected_items)
    for item, explanation in zip(selected_items, explanations):
        rows.append(
            {
                "rank": len(rows) + 1,
                "token": item.snapshot.symbol,
                "name": item.snapshot.name,
                "chain": item.snapshot.chain_id,
                "address": item.snapshot.token_address,
                "image_url": item.snapshot.image_url,
                "score": round(item.score, 2),
                "signal": item.signal,
                "price_usd": item.snapshot.price_usd,
                "market_cap": item.snapshot.market_cap,
                "fdv": item.snapshot.fdv,
                "liquidity_usd": item.snapshot.liquidity_usd,
                "volume_1h": item.snapshot.volume_1h,
                "volume_24h": item.snapshot.volume_24h,
                "txns_1h": item.snapshot.txns_1h,
                "buys_1h": item.snapshot.buys_1h,
                "sells_1h": item.snapshot.sells_1h,
                "price_change_5m": item.snapshot.price_change_5m,
                "price_change_1h": item.snapshot.price_change_1h,
                "price_change_6h": item.snapshot.price_change_6h,
                "price_change_24h": item.snapshot.price_change_24h,
                "age_minutes": item.snapshot.age_minutes,
                "pair_address": item.snapshot.pair_address,
                "pair_created_at": item.snapshot.pair_created_at,
                "risk_flags": item.risk_flags,
                "why": explanation,
                "url": item.snapshot.pair_url,
            }
        )
    return rows


def resolve_cached_token_image(config: ScannerConfig, name: str, symbol: str) -> str:
    key = f"{name.strip().lower()}:{symbol.strip().lower()}"
    if not key.strip(":"):
        return ""
    if key not in _IMAGE_CACHE:
        try:
            _IMAGE_CACHE[key] = resolve_token_image(config=config, name=name, symbol=symbol)
        except RuntimeError:
            _IMAGE_CACHE[key] = ""
    return _IMAGE_CACHE[key]
