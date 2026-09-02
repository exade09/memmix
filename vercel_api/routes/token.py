from __future__ import annotations

import json
import time
from typing import Any, Protocol
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from axiom_scanner.config import ScannerConfig
from axiom_scanner.http_client import HttpClient, SourceError
from axiom_scanner.security.fetch import fetch_public_bytes
from axiom_scanner.security.query import (
    BASE58_RE,
    QueryError,
    safe_image_url,
    sanitize_untrusted,
    snapshot_to_summary,
)
from axiom_scanner.sources.dexscreener import DexScreenerSource, _pair_to_snapshot
from vercel_api.launch_config import chain_rpc_url

INDEXER_NOTICE = (
    "The token is live on-chain. Market data will appear after external indexers discover trading activity."
)


class JsonGetter(Protocol):
    def get_json(self, url: str) -> Any: ...


def token_detail(
    mint: str,
    config: ScannerConfig,
    *,
    http: JsonGetter | None = None,
    rpc_post=None,
) -> dict:
    address = (mint or "").strip()
    if not BASE58_RE.fullmatch(address):
        raise QueryError("That mint address is not valid.", "INVALID_MINT")

    client = http or HttpClient(timeout_seconds=min(config.request_timeout_seconds, 10), retries=1)
    url = f"{DexScreenerSource.BASE_URL}/tokens/v1/robinhood/{address}"
    try:
        payload = client.get_json(url)
    except SourceError:
        payload = []

    pairs = payload if isinstance(payload, list) else payload.get("pairs", []) if isinstance(payload, dict) else []
    if not isinstance(pairs, list):
        pairs = []

    now_ms = int(time.time() * 1000)
    best = None
    for pair in pairs:
        if not isinstance(pair, dict):
            continue
        if str(pair.get("chainId", "")).lower() not in {"", "robinhood"}:
            continue
        pair.setdefault("chainId", "robinhood")
        snapshot = _pair_to_snapshot(pair, now_ms=now_ms)
        if snapshot.token_address.lower() != address.lower():
            continue
        summary = snapshot_to_summary(snapshot)
        if best is None or float(summary.get("liquidity_usd") or 0) > float(best.get("liquidity_usd") or 0):
            best = {**summary, "raw_pair": pair}

    mint_exists = rpc_mint_exists(address, rpc_post=rpc_post)
    if best is None and mint_exists is False:
        raise QueryError("No contract was found at that address.", "TOKEN_NOT_FOUND")

    if best is None:
        notice = None
        if mint_exists is True:
            notice = INDEXER_NOTICE
        elif mint_exists is None:
            notice = "On-chain lookup is delayed. Missing market data is not treated as a failed launch."
        return {
            "mint": address,
            "onchain": {
                "status": "unknown",
                "creator": None,
                "mint_exists": mint_exists,
            },
            "metadata": {
                "name": None,
                "symbol": None,
                "image_url": None,
                "socials": [],
            },
            "market": None,
            "lineage": None,
            "notice": notice,
        }

    pair = best.get("raw_pair") if isinstance(best.get("raw_pair"), dict) else {}
    info = pair.get("info") if isinstance(pair.get("info"), dict) else {}
    socials = []
    for item in info.get("socials") or []:
        if not isinstance(item, dict):
            continue
        social_url = safe_image_url(item.get("url"))
        if social_url:
            socials.append({"type": sanitize_untrusted(item.get("type") or "link", 24), "url": social_url})
    for item in info.get("websites") or []:
        if not isinstance(item, dict):
            continue
        site_url = safe_image_url(item.get("url"))
        if site_url:
            socials.append({"type": "website", "url": site_url})

    lineage = None
    image_url = best.get("image_url") or None
    name = best.get("name")
    symbol = best.get("symbol")
    metadata_uri = info.get("metadataUri") or info.get("metadata_uri")
    if isinstance(metadata_uri, str) and metadata_uri.startswith("https://"):
        fetched = _fetch_metadata_json(metadata_uri)
        if fetched:
            name = fetched.get("name") or name
            symbol = fetched.get("symbol") or symbol
            image_url = fetched.get("image") or image_url
            lineage = fetched.get("lineage")
            for item in fetched.get("socials") or []:
                if item not in socials:
                    socials.append(item)

    return {
        "mint": address,
        "onchain": {
            "status": "unknown",
            "creator": None,
            "mint_exists": True if mint_exists is None else mint_exists,
        },
        "metadata": {
            "name": name,
            "symbol": symbol,
            "image_url": image_url,
            "socials": socials,
        },
        "market": {
            "pair_address": best.get("pair_address"),
            "dex_id": best.get("dex_id"),
            "liquidity_usd": best.get("liquidity_usd"),
            "volume_24h_usd": best.get("volume_24h_usd"),
            "price_change_1h": best.get("price_change_1h"),
            "age_minutes": best.get("age_minutes"),
            "pair_url": pair.get("url"),
        },
        "lineage": lineage,
        "notice": None,
    }


def rpc_mint_exists(mint: str, *, rpc_post=None) -> bool | None:
    """
    An address is a token only if it holds contract code. An externally owned
    account returns "0x" and is reported as absent, the same honesty the
    Solana build got from checking the mint owner program.

    None means the node could not answer, which is not the same as absent.
    """
    body = {"jsonrpc": "2.0", "id": 1, "method": "eth_getCode", "params": [mint, "latest"]}
    try:
        payload = rpc_post(body) if rpc_post is not None else _post_rpc(body)
    except (OSError, TimeoutError, ValueError, json.JSONDecodeError, HTTPError, URLError):
        return None
    if not isinstance(payload, dict):
        return None
    result = payload.get("result")
    if not isinstance(result, str):
        return None
    return result not in {"", "0x", "0x0"}


def _post_rpc(payload: dict[str, Any]) -> dict[str, Any]:
    request = Request(
        chain_rpc_url(),
        data=json.dumps(payload).encode("utf-8"),
        method="POST",
        headers={"Accept": "application/json", "Content-Type": "application/json", "User-Agent": "fons-token/0.1"},
    )
    with urlopen(request, timeout=8) as response:
        parsed = json.loads(response.read().decode("utf-8"))
    if not isinstance(parsed, dict):
        raise ValueError("unusable rpc")
    return parsed


def _fetch_metadata_json(uri: str) -> dict[str, Any] | None:
    try:
        data, _content_type, _final = fetch_public_bytes(uri, max_bytes=64_000, timeout_seconds=8)
        payload = json.loads(data.decode("utf-8"))
    except Exception:
        return None
    if not isinstance(payload, dict):
        return None
    mixborn = payload.get("mixborn") if isinstance(payload.get("mixborn"), dict) else {}
    socials = []
    for key, label in (("twitter", "twitter"), ("telegram", "telegram"), ("website", "website")):
        url = safe_image_url(payload.get(key))
        if url:
            socials.append({"type": label, "url": url})
    lineage = None
    parent_a = mixborn.get("parent_a_mint")
    parent_b = mixborn.get("parent_b_mint")
    if isinstance(parent_a, str) or isinstance(parent_b, str):
        lineage = {"parent_a": parent_a, "parent_b": parent_b}
    image = payload.get("image")
    return {
        "name": sanitize_untrusted(payload.get("name") or "", 64) or None,
        "symbol": sanitize_untrusted(payload.get("symbol") or "", 16) or None,
        "image": safe_image_url(image) if isinstance(image, str) else None,
        "lineage": lineage,
        "socials": socials,
    }
