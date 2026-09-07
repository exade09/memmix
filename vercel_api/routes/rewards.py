from __future__ import annotations

"""
The vault's HTTP surface.

Reading is public: the balance, the holder count and what has been paid out
are all facts about a public wallet, and hiding them would defeat the point
of being checkable. Moving money is not: planning and executing a
distribution sit behind the same admin password the CA editor uses, and are
rate limited per IP.
"""

import hmac
import os
import time
from collections import defaultdict
from typing import Any

from axiom_scanner.chain.rpc_client import RpcClient
from axiom_scanner.http_client import HttpClient, SourceError
from axiom_scanner.rewards.config import platform_token_address, vault_address
from axiom_scanner.rewards.merkle import build_distribution
from axiom_scanner.rewards.rounds import (
    RoundError,
    add_round,
    claims_for,
    public_rounds,
)
from axiom_scanner.chain.stocks import find_stock
from axiom_scanner.rewards.holders import snapshot_holders, compute_shares
from axiom_scanner.rewards.vault import (
    VaultError,
    execute_distribution,
    plan_distribution,
    read_vault_state,
)
from vercel_api.launch_config import chain_rpc_url

RATE_LIMIT = 12
RATE_WINDOW_SECONDS = 600

_HITS: dict[str, list[float]] = defaultdict(list)


def reset_rewards_limits() -> None:
    _HITS.clear()


def _rate_limited(client_ip: str, *, now: float) -> bool:
    ip = client_ip or "unknown"
    hits = [t for t in _HITS[ip] if now - t < RATE_WINDOW_SECONDS]
    hits.append(now)
    _HITS[ip] = hits
    return len(hits) > RATE_LIMIT


def _check_password(password: str) -> None:
    expected = (os.getenv("ADMIN_CA_PASSWORD") or "").strip()
    if not expected:
        raise VaultError("Admin actions are not configured.", "ADMIN_DISABLED")
    supplied = (password or "").strip()
    # Constant time: this guards a wallet that sends money.
    if not supplied or not hmac.compare_digest(supplied, expected):
        raise VaultError("Wrong password.", "WRONG_PASSWORD")


def _rpc(http: Any = None) -> RpcClient:
    return RpcClient(chain_rpc_url(), http or HttpClient(timeout_seconds=20, retries=1))


def vault_state_route(*, http: Any = None, include_holders: bool = True) -> dict[str, Any]:
    try:
        return read_vault_state(_rpc(http), include_holders=include_holders)
    except SourceError as exc:
        raise VaultError("Could not read the vault right now.", "RPC_UNAVAILABLE") from exc


def vault_plan_route(body: dict[str, Any], client_ip: str, *, http: Any = None) -> dict[str, Any]:
    _guard(body, client_ip)
    amount = _amount(body)
    return plan_distribution(_rpc(http), amount)


def vault_distribute_route(body: dict[str, Any], client_ip: str, *, http: Any = None) -> dict[str, Any]:
    _guard(body, client_ip)
    amount = _amount(body)
    rpc = _rpc(http)
    plan = plan_distribution(rpc, amount)
    result = execute_distribution(rpc, plan)
    return {
        "plan": {
            "amount_wei": plan["amount_wei"],
            "recipient_count": plan["recipient_count"],
            "block_number": plan["block_number"],
            "complete_scan": plan["complete_scan"],
        },
        **result,
    }


def _guard(body: dict[str, Any], client_ip: str) -> None:
    if not isinstance(body, dict):
        raise VaultError("Request body must be JSON.", "INVALID_INPUT")
    if _rate_limited(client_ip, now=time.time()):
        raise VaultError("Too many attempts. Try again later.", "RATE_LIMITED")
    _check_password(str(body.get("password") or ""))


def _amount(body: dict[str, Any]) -> int:
    raw = body.get("amount_wei")
    try:
        amount = int(str(raw))
    except (TypeError, ValueError) as exc:
        raise VaultError("amount_wei must be a whole number of wei.", "INVALID_INPUT") from exc
    if amount <= 0:
        raise VaultError("amount_wei must be greater than zero.", "INVALID_INPUT")
    return amount


def vault_error_status(code: str) -> int:
    return (
        429
        if code == "RATE_LIMITED"
        else 401
        if code == "WRONG_PASSWORD"
        else 403
        if code in {"ADMIN_DISABLED", "NOT_CONFIGURED", "NO_WALLET", "WALLET_MISMATCH"}
        else 400
        if code
        in {
            "INVALID_INPUT",
            "NOTHING_TO_DISTRIBUTE",
            "INSUFFICIENT_VAULT_BALANCE",
            "NO_HOLDERS",
            "ALL_SHARES_DUST",
            "INCOMPLETE_HOLDER_SCAN",
            "ROOT_MISMATCH",
            "ROUND_EXISTS",
        }
        else 503
    )


# ---------------------------------------------------------------
# Payout rounds
# ---------------------------------------------------------------


def _asset_meta(asset: str) -> tuple[str, int]:
    """Symbol and decimals for whatever is being paid out."""
    if not asset or asset.lower() == "0x" + "0" * 40:
        return "ETH", 18
    stock = find_stock(asset)
    if stock:
        return stock["symbol"], int(stock["decimals"])
    return "TOKEN", 18


def vault_claims_route(address: str) -> dict[str, Any]:
    """Public: what this address can claim, with proofs. No password."""
    claims = claims_for(address)
    for claim in claims:
        symbol, decimals = _asset_meta(str(claim.get("asset") or ""))
        claim.setdefault("asset_symbol", symbol)
        claim.setdefault("asset_decimals", decimals)
    return {"address": address, "claims": claims, "count": len(claims)}


def vault_rounds_route() -> dict[str, Any]:
    return {"rounds": public_rounds()}


def vault_prepare_round_route(body: dict[str, Any], client_ip: str, *, http: Any = None) -> dict[str, Any]:
    """
    Work out a round without publishing anything.

    Returns the root and the exact per-address split, so it can be checked --
    and the root compared against a recomputation -- before any money moves.
    """
    _guard(body, client_ip)
    amount = _amount(body)
    asset = str(body.get("asset") or "").strip() or "0x" + "0" * 40

    token = platform_token_address()
    if not token:
        raise VaultError("There is no token to snapshot holders of yet.", "NOT_CONFIGURED")

    rpc = _rpc(http)
    snap = snapshot_holders(rpc, token, exclude={vault_address()} if vault_address() else None)
    if snap.total_supply_held <= 0:
        raise VaultError("No holders were found to distribute to.", "NO_HOLDERS")
    if not snap.complete:
        raise VaultError(
            "The holder list is incomplete, so this round could miss holders. "
            "Set FONS_TOKEN_START_BLOCK to the token's first block and try again.",
            "INCOMPLETE_HOLDER_SCAN",
        )

    payouts = compute_shares(snap, amount, min_payout=1)
    if not payouts:
        raise VaultError("Every share would round to zero.", "ALL_SHARES_DUST")

    dist = build_distribution(payouts)
    symbol, decimals = _asset_meta(asset)
    return {
        "asset": asset,
        "asset_symbol": symbol,
        "asset_decimals": decimals,
        "root": dist.root,
        "total_wei": str(dist.total),
        "requested_wei": str(amount),
        "snapshot_block": snap.block_number,
        "recipient_count": len(dist.entries),
        "payouts": {a: str(v) for a, v in payouts.items()},
    }


def vault_publish_round_route(body: dict[str, Any], client_ip: str) -> dict[str, Any]:
    """
    Record a round that has already been created on chain.

    The chain is the authority: this only stores the payouts so proofs can be
    rebuilt for holders. The root is recomputed here and compared with the one
    supplied, so a mismatched table cannot be filed against a real round.
    """
    _guard(body, client_ip)
    try:
        round_id = int(str(body.get("round_id")))
    except (TypeError, ValueError) as exc:
        raise VaultError("round_id must be a whole number.", "INVALID_INPUT") from exc

    raw_payouts = body.get("payouts")
    if not isinstance(raw_payouts, dict) or not raw_payouts:
        raise VaultError("payouts is required.", "INVALID_INPUT")
    try:
        payouts = {str(a): int(str(v)) for a, v in raw_payouts.items()}
    except (TypeError, ValueError) as exc:
        raise VaultError("payouts amounts must be whole numbers of wei.", "INVALID_INPUT") from exc

    dist = build_distribution(payouts)
    supplied_root = str(body.get("root") or "").lower()
    if supplied_root and supplied_root != dist.root.lower():
        raise VaultError(
            "These payouts do not produce the root that was given.", "ROOT_MISMATCH"
        )

    asset = str(body.get("asset") or "").strip() or "0x" + "0" * 40
    symbol, decimals = _asset_meta(asset)
    try:
        record = add_round(
            round_id=round_id,
            asset=asset,
            asset_symbol=symbol,
            asset_decimals=decimals,
            payouts=payouts,
            snapshot_block=int(body.get("snapshot_block") or 0),
            root=dist.root,
            total=dist.total,
        )
    except RoundError as exc:
        raise VaultError(str(exc), exc.code) from exc

    return {
        "round_id": record["round_id"],
        "root": record["root"],
        "total_wei": record["total_wei"],
        "recipient_count": len(payouts),
    }
