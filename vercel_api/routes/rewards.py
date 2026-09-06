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
from axiom_scanner.http_client import HttpClient
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
    return read_vault_state(_rpc(http), include_holders=include_holders)


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
        }
        else 503
    )
