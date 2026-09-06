from __future__ import annotations

"""
The tokenized equities a launch is allowed to trade against.

Pons lets a launch name any address as its pair token, and the factory does
not police that choice -- there is no allowlist on chain. For a launch the
visitor pays for themselves that is their business. For a sponsored launch it
is emphatically ours: Fons's own wallet pays the fee and the gas, so an
unchecked pair token is a way for someone to burn our balance on a contract
that is not an equity, or not a token at all.

Hence this file. The registry is a checked-in list, every entry of which was
read back off chain (address, symbol, decimals) rather than copied from a
listing page, and a sponsored launch will only ever pair against something in
it. Tickers that resolved to more than one contract were dropped rather than
guessed at.
"""

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

PROJECT_ROOT = Path(__file__).resolve().parents[2]
STOCKS_FILE = PROJECT_ROOT / "data" / "robinhood_stocks.json"

# `pairToken == address(0)` is the native ETH curve, and is always allowed.
NATIVE_PAIR_TOKEN = "0x0000000000000000000000000000000000000000"

# A real ticker is short. See the note in load_stocks: these are a guard
# against contracts that return enormous attacker-chosen strings.
MAX_SYMBOL_LENGTH = 12
MAX_NAME_LENGTH = 64


@lru_cache(maxsize=1)
def load_stocks() -> tuple[dict[str, Any], ...]:
    try:
        raw = json.loads(STOCKS_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return ()
    items = raw.get("stocks") if isinstance(raw, dict) else raw
    if not isinstance(items, list):
        return ()
    cleaned: list[dict[str, Any]] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        address = str(item.get("address") or "").strip()
        symbol = str(item.get("symbol") or "").strip()
        name = str(item.get("name") or symbol).strip()
        if not address.startswith("0x") or len(address) != 42 or not symbol:
            continue
        """
        Length caps, because a token's symbol() and name() are attacker
        controlled. One spam contract on this chain returns a 43,000 character
        "symbol" that is a concatenation of every ticker it could think of --
        including the substring the discovery pass was matching on, which is
        how it got in here in the first place. A real ticker is a handful of
        characters; anything else is not an equity we should be offering.
        """
        if len(symbol) > MAX_SYMBOL_LENGTH or len(name) > MAX_NAME_LENGTH:
            continue
        try:
            decimals = int(item.get("decimals", 18))
        except (TypeError, ValueError):
            continue
        if decimals < 0 or decimals > 36:
            continue
        cleaned.append({"symbol": symbol, "name": name, "address": address, "decimals": decimals})
    return tuple(cleaned)


def public_stock_list() -> list[dict[str, Any]]:
    """What the browser is given. Nothing here is secret; it is a list of public contracts."""
    return [dict(item) for item in load_stocks()]


def find_stock(address: str) -> dict[str, Any] | None:
    needle = str(address or "").strip().lower()
    if not needle:
        return None
    for item in load_stocks():
        if item["address"].lower() == needle:
            return dict(item)
    return None


def is_native_pair(address: str) -> bool:
    return str(address or "").strip().lower() in {"", NATIVE_PAIR_TOKEN}


def is_allowed_pair_token(address: str) -> bool:
    """Native ETH, or a stock this build has verified. Nothing else."""
    if is_native_pair(address):
        return True
    return find_stock(address) is not None
