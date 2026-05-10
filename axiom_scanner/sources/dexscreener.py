from __future__ import annotations

import time
from collections import defaultdict
from typing import Any

from axiom_scanner.config import ScannerConfig
from axiom_scanner.http_client import HttpClient
from axiom_scanner.models import TokenSnapshot
from axiom_scanner.sources.base import TokenSource


class DexScreenerSource(TokenSource):
    BASE_URL = "https://api.dexscreener.com"

    def __init__(self, config: ScannerConfig) -> None:
        self.config = config
        self.http = HttpClient(timeout_seconds=config.request_timeout_seconds)

    def fetch_tokens(self) -> list[TokenSnapshot]:
        candidates = self._fetch_candidate_tokens()
        pairs = self._fetch_pairs_for_candidates(candidates)
        return self._normalize_pairs(pairs)

    def _fetch_candidate_tokens(self) -> list[dict[str, Any]]:
        urls = [
            f"{self.BASE_URL}/token-profiles/latest/v1",
            f"{self.BASE_URL}/token-boosts/latest/v1",
            f"{self.BASE_URL}/token-boosts/top/v1",
        ]
        allowed_chains = {chain.lower() for chain in self.config.chains}
        seen: set[tuple[str, str]] = set()
        candidates: list[dict[str, Any]] = []

        for url in urls:
            payload = self.http.get_json(url)
            if not isinstance(payload, list):
                continue

            for item in payload:
                chain_id = str(item.get("chainId", "")).lower()
                address = str(item.get("tokenAddress", "")).strip()
                key = (chain_id, address.lower())
                if not chain_id or not address or key in seen:
                    continue
                if allowed_chains and chain_id not in allowed_chains:
                    continue

                seen.add(key)
                candidates.append(item)
                if len(candidates) >= self.config.source.max_candidate_tokens:
                    return candidates

        return candidates

    def _fetch_pairs_for_candidates(
        self, candidates: list[dict[str, Any]]
    ) -> list[dict[str, Any]]:
        by_chain: dict[str, list[str]] = defaultdict(list)
        for item in candidates:
            chain_id = str(item.get("chainId", "")).lower()
            address = str(item.get("tokenAddress", "")).strip()
            if chain_id and address:
                by_chain[chain_id].append(address)

        pairs: list[dict[str, Any]] = []
        for chain_id, addresses in by_chain.items():
            for chunk in _chunks(_dedupe(addresses), size=30):
                url = f"{self.BASE_URL}/tokens/v1/{chain_id}/{','.join(chunk)}"
                payload = self.http.get_json(url)
                if isinstance(payload, list):
                    pairs.extend(pair for pair in payload if isinstance(pair, dict))

        return pairs

    def _normalize_pairs(self, pairs: list[dict[str, Any]]) -> list[TokenSnapshot]:
        snapshots_by_token: dict[tuple[str, str], TokenSnapshot] = {}
        now_ms = int(time.time() * 1000)

        for pair in pairs:
            base_token = pair.get("baseToken") or {}
            chain_id = str(pair.get("chainId", "")).lower()
            token_address = str(base_token.get("address", "")).strip()
            if not chain_id or not token_address:
                continue

            snapshot = _pair_to_snapshot(pair, now_ms=now_ms)
            if not _passes_basic_filters(snapshot, self.config):
                continue

            key = (snapshot.chain_id, snapshot.token_address.lower())
            existing = snapshots_by_token.get(key)
            if existing is None or snapshot.liquidity_usd > existing.liquidity_usd:
                snapshots_by_token[key] = snapshot

        return list(snapshots_by_token.values())


def _pair_to_snapshot(pair: dict[str, Any], now_ms: int) -> TokenSnapshot:
    base_token = pair.get("baseToken") or {}
    liquidity = pair.get("liquidity") or {}
    volume = pair.get("volume") or {}
    txns = pair.get("txns") or {}
    price_change = pair.get("priceChange") or {}
    info = pair.get("info") or {}
    boosts = pair.get("boosts") or {}
    pair_created_at = _to_int(pair.get("pairCreatedAt"))

    age_minutes: float | None = None
    if pair_created_at:
        age_minutes = max((now_ms - pair_created_at) / 60_000, 0)

    h1_txns = txns.get("h1") or {}
    m5_txns = txns.get("m5") or {}
    h6_txns = txns.get("h6") or {}
    h24_txns = txns.get("h24") or {}

    websites = info.get("websites") or []
    socials = info.get("socials") or []

    return TokenSnapshot(
        source="dexscreener",
        chain_id=str(pair.get("chainId", "")).lower(),
        token_address=str(base_token.get("address", "")),
        symbol=str(base_token.get("symbol", "?"))[:24],
        name=str(base_token.get("name", ""))[:80],
        pair_address=str(pair.get("pairAddress", "")),
        pair_url=str(pair.get("url", "")),
        image_url=str(info.get("imageUrl") or info.get("openGraph") or ""),
        price_usd=_to_float(pair.get("priceUsd")),
        market_cap=_to_float(pair.get("marketCap")),
        fdv=_to_float(pair.get("fdv")),
        liquidity_usd=_to_float(liquidity.get("usd")),
        volume_5m=_to_float(volume.get("m5")),
        volume_1h=_to_float(volume.get("h1")),
        volume_6h=_to_float(volume.get("h6")),
        volume_24h=_to_float(volume.get("h24")),
        txns_5m=_txn_count(m5_txns),
        txns_1h=_txn_count(h1_txns),
        txns_6h=_txn_count(h6_txns),
        txns_24h=_txn_count(h24_txns),
        buys_1h=_to_int(h1_txns.get("buys")),
        sells_1h=_to_int(h1_txns.get("sells")),
        price_change_5m=_to_float(price_change.get("m5")),
        price_change_1h=_to_float(price_change.get("h1")),
        price_change_6h=_to_float(price_change.get("h6")),
        price_change_24h=_to_float(price_change.get("h24")),
        pair_created_at=pair_created_at,
        age_minutes=age_minutes,
        socials_count=len(websites) + len(socials),
        boosts_active=_to_int(boosts.get("active")),
        raw=pair,
    )


def _passes_basic_filters(snapshot: TokenSnapshot, config: ScannerConfig) -> bool:
    if snapshot.liquidity_usd < config.min_liquidity_usd:
        return False
    if snapshot.age_minutes is None:
        return True
    return snapshot.age_minutes <= config.max_token_age_hours * 60


def _txn_count(value: dict[str, Any]) -> int:
    return _to_int(value.get("buys")) + _to_int(value.get("sells"))


def _to_float(value: Any) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def _to_int(value: Any) -> int:
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


def _chunks(items: list[str], size: int) -> list[list[str]]:
    return [items[index : index + size] for index in range(0, len(items), size)]


def _dedupe(items: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for item in items:
        key = item.lower()
        if key not in seen:
            seen.add(key)
            result.append(item)
    return result
