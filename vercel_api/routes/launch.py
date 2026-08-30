from __future__ import annotations

from typing import Any

from axiom_scanner.http_client import SourceError
from axiom_scanner.security.fields import require_name, require_ticker
from axiom_scanner.security.query import QueryError
from vercel_api.routes.search import search_tokens
from vercel_api.shared import runtime_config


NAME_CHECK_NOTICE = "Identity is the mint address; similar names do not block launch."
NAME_CHECK_UNAVAILABLE = "Check unavailable"


def name_check_route(name: str, ticker: str, *, config=None, search=None) -> dict[str, Any]:
    finder = search or search_tokens
    try:
        clean_name = require_name(name)
        clean_ticker = require_ticker(ticker)
    except QueryError:
        return {
            "check_available": False,
            "name_matches": 0,
            "ticker_matches": 0,
            "notice": NAME_CHECK_UNAVAILABLE,
        }
    try:
        scanner = config or runtime_config()
        name_items = finder(clean_name, 8, scanner).get("items") or []
        ticker_items = finder(clean_ticker, 8, scanner).get("items") or []
    except (SourceError, RuntimeError, QueryError, TypeError, ValueError):
        return {
            "check_available": False,
            "name_matches": 0,
            "ticker_matches": 0,
            "notice": NAME_CHECK_UNAVAILABLE,
        }
    name_matches = sum(
        1 for item in name_items if str(item.get("name") or "").strip().lower() == clean_name.lower()
    )
    ticker_matches = sum(
        1
        for item in ticker_items
        if str(item.get("symbol") or "").upper().lstrip("$") == clean_ticker
    )
    return {
        "check_available": True,
        "name_matches": name_matches,
        "ticker_matches": ticker_matches,
        "notice": NAME_CHECK_NOTICE,
    }
