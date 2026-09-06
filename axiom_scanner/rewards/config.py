from __future__ import annotations

"""
Where the rewards vault reads its identity from.

Two addresses decide whether any of this is live: the token whose holders
are paid, and the wallet that holds and sends the fees. Both are read from
the environment, and the token falls back to the contract address the CA
admin already publishes -- so once $FONS launches and its address is set
there, the vault starts reading real balances without a second place to
update.
"""

import json
import os
import re
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
CA_FILE = PROJECT_ROOT / "data" / "ca.json"

ADDRESS_RE = re.compile(r"^0x[a-fA-F0-9]{40}$")

# Holders below this are skipped when distributing: their share would be worth
# less than the gas needed to send it, so paying them costs the vault money.
DEFAULT_MIN_PAYOUT_WEI = 10**13  # 0.00001 ETH


def _clean_address(value: object) -> str:
    text = str(value or "").strip()
    return text if ADDRESS_RE.match(text) else ""


def platform_token_address() -> str:
    """
    The token whose holders get paid. Explicit env wins; otherwise the
    published CA is used, which is where the address lands first anyway.
    """
    explicit = _clean_address(os.getenv("FONS_TOKEN_ADDRESS"))
    if explicit:
        return explicit
    try:
        raw = json.loads(CA_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return ""
    # "TBA", a note, or anything that is not an address means "not launched".
    return _clean_address(raw.get("ca") if isinstance(raw, dict) else "")


def vault_address() -> str:
    """
    The wallet fees collect in and are sent from. Defaults to the sponsor
    wallet, which is already the creator-fee recipient on sponsored launches.
    """
    explicit = _clean_address(os.getenv("REWARDS_VAULT_ADDRESS"))
    if explicit:
        return explicit
    from axiom_scanner.chain.sponsor_wallet import sponsor_address

    return _clean_address(sponsor_address())


def creator_fee_bps() -> int:
    """
    The creator fee applied to sponsored launches, in basis points.

    Zero by default, which is what shipped before this existed: turning it on
    is a deliberate act, because it is a real fee charged on other people's
    trades. Capped at the factory's own 10% ceiling.
    """
    raw = (os.getenv("SPONSORED_CREATOR_FEE_BPS") or "0").strip()
    try:
        value = int(raw)
    except ValueError:
        return 0
    return max(0, min(value, 1000))


def token_start_block() -> int:
    """
    The block the token was created in, so the holder scan can cover its whole
    history instead of guessing how far back to look.

    This matters more than it sounds. Robinhood Chain produces blocks fast
    enough that scanning "the last few thousand blocks" covers only hours, and
    a holder who bought before that window would be missing from the snapshot
    and silently paid nothing. With this set, the scan starts where the token
    does and cannot miss anyone.
    """
    raw = (os.getenv("FONS_TOKEN_START_BLOCK") or "").strip()
    try:
        return max(0, int(raw))
    except ValueError:
        return 0


def min_payout_wei() -> int:
    raw = (os.getenv("REWARDS_MIN_PAYOUT_WEI") or "").strip()
    try:
        value = int(raw)
    except ValueError:
        return DEFAULT_MIN_PAYOUT_WEI
    return max(0, value)


def rewards_enabled() -> bool:
    """Live only when there is a token to pay holders of and a wallet to pay from."""
    return bool(platform_token_address() and vault_address())
