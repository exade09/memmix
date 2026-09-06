from __future__ import annotations

"""
Published payout rounds.

Only the payouts themselves are stored -- {address: amount} plus which asset
and which snapshot block. Proofs are rebuilt from that on demand, because a
Merkle tree over a few thousand entries takes milliseconds and storing the
proofs would mean keeping a large file in sync with a chain that already has
the authoritative copy of the root.

That also keeps this honest: the root published on chain is the thing that
matters, and anyone can recompute it from the same payouts and check that it
matches. A stored proof nobody could reproduce would be worth less.
"""

import json
import os
import time
from pathlib import Path
from typing import Any

from axiom_scanner.rewards.merkle import MerkleDistribution, build_distribution

PROJECT_ROOT = Path(__file__).resolve().parents[2]
ROUNDS_FILE = PROJECT_ROOT / "data" / "reward_rounds.json"

NATIVE = "0x0000000000000000000000000000000000000000"


class RoundError(RuntimeError):
    def __init__(self, message: str, code: str) -> None:
        super().__init__(message)
        self.code = code


def _read_raw() -> dict[str, Any]:
    try:
        raw = json.loads(ROUNDS_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {"rounds": []}
    return raw if isinstance(raw, dict) else {"rounds": []}


def load_rounds() -> list[dict[str, Any]]:
    rounds = _read_raw().get("rounds")
    return [r for r in rounds if isinstance(r, dict)] if isinstance(rounds, list) else []


def _write(rounds: list[dict[str, Any]]) -> None:
    payload = {
        "note": (
            "Published reward rounds. Proofs are not stored: they are rebuilt from these payouts, "
            "and the Merkle root on chain is what actually authorises a claim."
        ),
        "rounds": rounds,
    }
    ROUNDS_FILE.parent.mkdir(parents=True, exist_ok=True)
    ROUNDS_FILE.write_text(json.dumps(payload, indent=2, ensure_ascii=True) + "\n", encoding="utf-8")


def distribution_for(round_record: dict[str, Any]) -> MerkleDistribution:
    payouts = {
        str(addr): int(amount) for addr, amount in (round_record.get("payouts") or {}).items()
    }
    return build_distribution(payouts)


def add_round(
    *,
    round_id: int,
    asset: str,
    asset_symbol: str,
    asset_decimals: int,
    payouts: dict[str, int],
    snapshot_block: int,
    root: str,
    total: int,
) -> dict[str, Any]:
    rounds = load_rounds()
    if any(int(r.get("round_id", -1)) == int(round_id) for r in rounds):
        raise RoundError(f"Round {round_id} is already recorded.", "ROUND_EXISTS")

    record = {
        "round_id": int(round_id),
        "asset": asset,
        "asset_symbol": asset_symbol,
        "asset_decimals": int(asset_decimals),
        "root": root,
        "total_wei": str(total),
        "snapshot_block": int(snapshot_block),
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "payouts": {addr: str(amount) for addr, amount in payouts.items()},
    }
    rounds.append(record)
    rounds.sort(key=lambda r: int(r.get("round_id", 0)))
    _write(rounds)
    return record


def public_rounds() -> list[dict[str, Any]]:
    """Round metadata without the full payout table, which can be large."""
    out = []
    for record in load_rounds():
        out.append(
            {
                "round_id": record.get("round_id"),
                "asset": record.get("asset"),
                "asset_symbol": record.get("asset_symbol"),
                "asset_decimals": record.get("asset_decimals", 18),
                "root": record.get("root"),
                "total_wei": record.get("total_wei"),
                "snapshot_block": record.get("snapshot_block"),
                "created_at": record.get("created_at"),
                "recipient_count": len(record.get("payouts") or {}),
            }
        )
    return out


def claims_for(address: str) -> list[dict[str, Any]]:
    """
    Everything this address can claim, with the proof for each.

    Matching is case-insensitive because wallets hand back addresses in
    whatever case they feel like, but the proof is always built from the
    address exactly as it was recorded -- the leaf hashes the bytes, and a
    re-cased address hashes differently and would not verify.
    """
    needle = str(address or "").strip().lower()
    if not needle:
        return []

    claims: list[dict[str, Any]] = []
    for record in load_rounds():
        payouts = record.get("payouts") or {}
        matched = next((a for a in payouts if a.lower() == needle), None)
        if matched is None:
            continue
        entry = distribution_for(record).entries.get(matched)
        if entry is None:
            continue
        claims.append(
            {
                "round_id": record.get("round_id"),
                "asset": record.get("asset"),
                "asset_symbol": record.get("asset_symbol"),
                "asset_decimals": record.get("asset_decimals", 18),
                "snapshot_block": record.get("snapshot_block"),
                "index": entry.index,
                "account": entry.account,
                "amount_wei": str(entry.amount),
                "proof": entry.proof,
            }
        )
    return claims
