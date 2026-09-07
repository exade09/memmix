from __future__ import annotations

"""
Reading and writing the rewards settings.

The public read exists because the browser needs one of these values -- the
distributor address, so the claim button knows where to send a claim. It is
already public: it is a contract address, printed in every claim transaction.
Nothing password-shaped is served here.

The write is password-gated and rate limited exactly like the CA editor, and
for the same reason: these values decide where fees go and how a payout is
computed.
"""

import hmac
import os
import time
from collections import defaultdict
from typing import Any

from axiom_scanner.rewards.config import (
    creator_fee_bps,
    distributor_address,
    platform_token_address,
    token_start_block,
    vault_address,
)
# Imported as a module, not as names: the file path is looked up when the
# write happens, so reads and writes can never end up pointing at different
# files.
from axiom_scanner.rewards import settings as settings_store
from axiom_scanner.rewards.settings import SettingsError, read_settings, validate
from axiom_scanner.chain.rpc_client import RpcClient
from axiom_scanner.http_client import HttpClient
from axiom_scanner.rewards.launch_lookup import LaunchLookupError, find_launch
from vercel_api.github_store import StoreError, save_json
from vercel_api.launch_config import chain_rpc_url, launchpad_address

RATE_LIMIT = 8
RATE_WINDOW_SECONDS = 600

_HITS: dict[str, list[float]] = defaultdict(list)


class SettingsRouteError(RuntimeError):
    def __init__(self, message: str, code: str) -> None:
        super().__init__(message)
        self.code = code


def reset_settings_rate_limit() -> None:
    _HITS.clear()


def public_settings_route() -> dict[str, Any]:
    """What the browser is allowed to know, which is only the addresses."""
    return {
        "distributor": distributor_address() or None,
        "token": platform_token_address() or None,
    }


def admin_settings_route() -> dict[str, Any]:
    """
    The panel's view: what is stored, and what is actually in effect.

    Both, not just one. A field can be blank here while the value in effect is
    non-zero, because the environment is still answering -- and an operator
    who sees only the blank field will assume nothing is set and be wrong.
    """
    stored = read_settings()
    return {
        "stored": stored,
        "effective": {
            "fons_token_address": platform_token_address() or None,
            "fons_token_start_block": token_start_block(),
            "rewards_distributor_address": distributor_address() or None,
            "rewards_vault_address": vault_address() or None,
            "creator_fee_bps": creator_fee_bps(),
        },
    }


def detect_launch_route(body: dict[str, Any], client_ip: str, *, http: Any = None) -> dict[str, Any]:
    """
    Look up a token's launch block on the Pons factory.

    $FONS launches through the same factory as everything else on the site,
    so its first block is already on chain. Reading it beats asking someone
    to copy it: a start block that is wrong by a little raises no error at
    all, it just silently pays nothing to everyone who bought earlier.
    """
    authorise(body, client_ip)
    token = str(body.get("token") or "").strip()
    if not token:
        token = platform_token_address()
    if not token:
        raise SettingsRouteError(
            "There is no token address to look up yet. Publish the CA first, "
            "or type the address into the field above.",
            "INVALID_INPUT",
        )
    rpc = RpcClient(chain_rpc_url(), http or HttpClient(timeout_seconds=20, retries=1))
    try:
        return find_launch(rpc, token, launchpad_address())
    except LaunchLookupError as exc:
        raise SettingsRouteError(str(exc), exc.code) from exc
    except ValueError as exc:
        raise SettingsRouteError(f"That is not a valid address: {exc}", "INVALID_INPUT") from exc


def authorise(body: dict[str, Any], client_ip: str, *, now: float | None = None) -> None:
    """
    The gate in front of both reading and writing.

    Reading is gated too: the panel reports which values are in effect, and
    that is a map of where the fees go. Separate from the write so that
    opening the panel cannot save anything.
    """
    stamp = now if now is not None else time.time()

    if not isinstance(body, dict):
        raise SettingsRouteError("Request body must be JSON.", "INVALID_INPUT")
    if _rate_limited(client_ip, now=stamp):
        raise SettingsRouteError("Too many attempts. Try again later.", "RATE_LIMITED")

    expected = (os.getenv("ADMIN_CA_PASSWORD") or "").strip()
    if not expected:
        raise SettingsRouteError("Admin actions are not configured.", "ADMIN_DISABLED")
    supplied = str(body.get("password") or "").strip()
    # Constant time: this guards where the fees go.
    if not supplied or not hmac.compare_digest(supplied, expected):
        raise SettingsRouteError("Wrong password.", "WRONG_PASSWORD")


def update_settings_route(body: dict[str, Any], client_ip: str, *, now: float | None = None) -> dict[str, Any]:
    stamp = now if now is not None else time.time()
    authorise(body, client_ip, now=stamp)

    patch = {key: value for key, value in body.items() if key != "password"}
    try:
        settings = validate(patch)
    except SettingsError as exc:
        raise SettingsRouteError(str(exc), exc.code) from exc

    payload = dict(settings)
    payload["updated_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(stamp))
    try:
        live_in = save_json(
            path=settings_store.SETTINGS_FILE,
            rel_path="data/settings.json",
            payload=payload,
            message="Update rewards settings",
        )
    except StoreError as exc:
        raise SettingsRouteError(str(exc), exc.code) from exc

    return {**admin_settings_route(), "live_in_seconds": live_in}


def settings_error_status(code: str) -> int:
    return (
        429
        if code == "RATE_LIMITED"
        else 401
        if code == "WRONG_PASSWORD"
        else 403
        if code == "ADMIN_DISABLED"
        else 400
        if code in {"INVALID_INPUT", "LAUNCH_NOT_FOUND"}
        else 503
    )


def _rate_limited(client_ip: str, *, now: float) -> bool:
    ip = client_ip or "unknown"
    hits = [t for t in _HITS[ip] if now - t < RATE_WINDOW_SECONDS]
    hits.append(now)
    _HITS[ip] = hits
    return len(hits) > RATE_LIMIT
