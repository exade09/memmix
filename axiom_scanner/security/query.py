from __future__ import annotations

import html
import re
from urllib.parse import urlparse

from axiom_scanner.models import TokenSnapshot


ALLOWED_SEARCH_HOSTS = {
    "dexscreener.com",
    "www.dexscreener.com",
    "robinhoodchain.blockscout.com",
}
# Token identity on Robinhood Chain is a 20-byte contract address.
# BASE58_RE keeps its name so callers stay unchanged; only the shape moved.
BASE58_RE = re.compile(r"^0x[0-9a-fA-F]{40}$")
# Near misses: hex that is almost, but not quite, an address. Caught so the
# user is told the address is wrong rather than shown an empty name search.
LOOKS_LIKE_MINT_RE = re.compile(r"^0x[0-9a-fA-F]{30,39}$")
LOOKS_LIKE_SHORT_MINT_RE = re.compile(r"^[0-9a-fA-F]{40}$")
LOOKS_LIKE_LONG_MINT_RE = re.compile(r"^0x[0-9a-fA-F]{41,64}$")
TAG_RE = re.compile(r"<[^>]*>")
CONTROL_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f]")

RISK_LABELS = {
    "too_new": "very new token",
    "thin_liquidity": "very low liquidity",
    "sell_pressure": "heavy sell pressure",
    "dumping": "extreme short-term move",
    "missing_image": "missing image/metadata",
    "low_activity": "low activity",
    "cached_example": "cached example",
}


class QueryError(ValueError):
    def __init__(self, message: str, code: str = "INVALID_INPUT") -> None:
        super().__init__(message)
        self.code = code


def parse_search_query(raw: str) -> tuple[str, str | None]:
    query = (raw or "").strip()
    if not query:
        raise QueryError("Query is required.")
    if len(query) > 120:
        raise QueryError("Query is too long.")

    if BASE58_RE.fullmatch(query):
        return query, query
    if LOOKS_LIKE_MINT_RE.fullmatch(query) or LOOKS_LIKE_SHORT_MINT_RE.fullmatch(query) or LOOKS_LIKE_LONG_MINT_RE.fullmatch(query):
        raise QueryError("That contract address is not valid.", "INVALID_MINT")

    if "://" in query or query.startswith("www."):
        mint = mint_from_url(query)
        if not mint:
            raise QueryError("Only DexScreener and Blockscout token URLs are accepted.")
        return mint, mint

    if len(query) < 2:
        raise QueryError("Type at least two characters, a contract address, or a token URL.")
    return query, None


def mint_from_url(raw: str) -> str | None:
    parsed = urlparse(raw if "://" in raw else f"https://{raw}")
    host = parsed.netloc.lower()
    if host not in ALLOWED_SEARCH_HOSTS:
        return None
    parts = [part for part in parsed.path.split("/") if part]
    if host.endswith("blockscout.com"):
        # /token/0x... and /address/0x... both identify a contract
        if len(parts) >= 2 and parts[0] in {"token", "address"} and BASE58_RE.fullmatch(parts[1]):
            return parts[1]
        return None
    if host.endswith("dexscreener.com"):
        if len(parts) >= 2 and parts[0] == "robinhood" and BASE58_RE.fullmatch(parts[1]):
            return parts[1]
    return None


def sanitize_untrusted(value: object, max_len: int = 80) -> str:
    text = html.unescape(str(value or ""))
    text = TAG_RE.sub("", text)
    text = CONTROL_RE.sub("", text)
    return text.strip()[:max_len]


def safe_image_url(value: object) -> str:
    url = str(value or "").strip()
    if not url:
        return ""
    if url.startswith("/assets/"):
        return url
    parsed = urlparse(url)
    if parsed.scheme in {"http", "https"} and parsed.netloc:
        return url
    return ""


def optional_number(value: object) -> float | None:
    if value is None or value == "":
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if number != number:  # NaN
        return None
    return number


def clamp_score(value: object) -> float | None:
    number = optional_number(value)
    if number is None:
        return None
    return max(0.0, min(100.0, number))


def public_risk_flags(flags: object, *, has_image: bool) -> list[str]:
    labels: list[str] = []
    raw_flags = flags if isinstance(flags, list) else []
    for flag in raw_flags:
        key = str(flag)
        label = RISK_LABELS.get(key, key.replace("_", " "))
        if label and label not in labels:
            labels.append(label)
    if not has_image and "missing image/metadata" not in labels:
        labels.append("missing image/metadata")
    return labels[:8]


def collision_warning(items: list[dict[str, object]], query: str) -> str | None:
    needle = query.strip().lstrip("$").lower()
    if not needle or not items:
        return None
    ticker_mints = {
        str(item.get("mint", "")).lower()
        for item in items
        if str(item.get("symbol", "")).lower().lstrip("$") == needle
    }
    name_mints = {
        str(item.get("mint", "")).lower()
        for item in items
        if str(item.get("name", "")).lower() == needle
    }
    if len(ticker_mints) > 1 or len(name_mints) > 1:
        return "Matching names or tickers are not the same token. Mint is the identity."
    return None


def snapshot_to_summary(snapshot: TokenSnapshot, *, source: str = "dexscreener") -> dict[str, object]:
    raw = snapshot.raw if isinstance(snapshot.raw, dict) else {}
    liquidity = raw.get("liquidity") if isinstance(raw.get("liquidity"), dict) else {}
    volume = raw.get("volume") if isinstance(raw.get("volume"), dict) else {}
    price_change = raw.get("priceChange") if isinstance(raw.get("priceChange"), dict) else {}
    image_url = safe_image_url(snapshot.image_url)
    return {
        "mint": snapshot.token_address,
        "name": sanitize_untrusted(snapshot.name, 80),
        "symbol": sanitize_untrusted(snapshot.symbol, 24),
        "image_url": image_url,
        "pair_address": snapshot.pair_address or None,
        "dex_id": raw.get("dexId") if raw else None,
        "liquidity_usd": _first_number(liquidity.get("usd"), snapshot.liquidity_usd if snapshot.liquidity_usd else None),
        "volume_24h_usd": _first_number(volume.get("h24"), snapshot.volume_24h if snapshot.volume_24h else None),
        "price_change_1h": _first_number(price_change.get("h1"), snapshot.price_change_1h if snapshot.raw else None),
        "created_at": snapshot.pair_created_at,
        "source": source,
        "age_minutes": snapshot.age_minutes,
        "score": None,
        "signal": None,
        "risk_flags": public_risk_flags([], has_image=bool(image_url)),
    }


def _first_number(*values: object) -> float | None:
    for value in values:
        number = optional_number(value)
        if number is not None:
            return number
    return None


def scan_row_to_summary(row: dict[str, object]) -> dict[str, object]:
    image_url = safe_image_url(row.get("image_url") or "")
    flags = row.get("risk_flags") or []
    bundled = "cached_example" in flags or "local fallback data" in [str(flag) for flag in flags]
    return {
        "mint": str(row.get("address") or ""),
        "name": sanitize_untrusted(row.get("name") or row.get("token") or "", 80),
        "symbol": sanitize_untrusted(row.get("token") or "", 24),
        "image_url": image_url,
        "pair_address": row.get("pair_address") or None,
        "dex_id": None,
        "liquidity_usd": optional_number(row.get("liquidity_usd")),
        "volume_24h_usd": optional_number(row.get("volume_24h") if row.get("volume_24h") not in (None, "") else row.get("volume_1h")),
        "price_change_1h": optional_number(row.get("price_change_1h")),
        "created_at": row.get("pair_created_at"),
        "source": "bundled" if bundled else "dexscreener",
        "age_minutes": optional_number(row.get("age_minutes")),
        "score": clamp_score(row.get("score")),
        "signal": row.get("signal"),
        "risk_flags": public_risk_flags(flags, has_image=bool(image_url)),
    }
