from __future__ import annotations

from axiom_scanner.security.query import scan_row_to_summary
from vercel_api.shared import scan_payload


def feed_tokens(
    tab: str,
    limit: int,
    *,
    min_liquidity: float | None = None,
    min_volume: float | None = None,
    max_age_hours: float | None = None,
    has_image: bool | None = None,
) -> dict:
    payload = scan_payload(limit=max(limit, 24))
    rows = [scan_row_to_summary(row) for row in payload.get("tokens", []) if isinstance(row, dict)]
    if tab == "new":
        floor = min_liquidity if min_liquidity is not None else 1000.0
        rows = [item for item in rows if _num(item.get("liquidity_usd")) >= floor]
        rows.sort(key=lambda item: _age(item))
    elif tab == "mixable":
        rows = [
            item
            for item in rows
            if item.get("image_url") and item.get("name") and item.get("symbol")
        ]
    rows = [item for item in rows if _matches_filters(item, min_liquidity, min_volume, max_age_hours, has_image)]
    return {
        "tokens": rows[:limit],
        "generated_at": payload.get("updated_at"),
        "data_source": payload.get("data_source"),
        "fallback_error": payload.get("fallback_error") or "",
    }


def _matches_filters(
    item: dict,
    min_liquidity: float | None,
    min_volume: float | None,
    max_age_hours: float | None,
    has_image: bool | None,
) -> bool:
    if min_liquidity is not None and _num(item.get("liquidity_usd")) < min_liquidity:
        return False
    if min_volume is not None and _num(item.get("volume_24h_usd")) < min_volume:
        return False
    if max_age_hours is not None:
        age = item.get("age_minutes")
        if age is None or float(age) > max_age_hours * 60:
            return False
    if has_image is True and not item.get("image_url"):
        return False
    if has_image is False and item.get("image_url"):
        return False
    return True


def _num(value: object) -> float:
    try:
        return float(value) if value is not None else 0.0
    except (TypeError, ValueError):
        return 0.0


def _age(item: dict) -> float:
    value = item.get("age_minutes")
    try:
        return float(value) if value is not None else 10**9
    except (TypeError, ValueError):
        return 10**9
