from __future__ import annotations

"""
Sponsored launch: Fons pays the launch fee and gas from its own hot wallet
instead of the visitor's.

This is the one launch path that does not run through the visitor's own
MetaMask. Because of that it carries its own, stricter gate: it is off by
default (ENABLE_SPONSORED_LAUNCH), every field is re-validated server-side
exactly as if it were untrusted input from the open internet (because it
is), the call is simulated against the chain before anything is sent, and
every request is rate-limited per IP against a wallet that really does
spend real ETH on a real network.

The on-chain deployer for a sponsored launch is the sponsor wallet, not the
visitor -- the factory has no separate "creator" field, only msg.sender. The
visitor's own wallet still goes into TokenParams.creatorFeeRecipient, so any
creator-tax revenue still flows to them.
"""

import secrets
import time
from collections import defaultdict
from typing import Any

from axiom_scanner.chain.pons_abi import (
    EthAddressError,
    Socials,
    TokenParams,
    ZERO_ADDRESS,
    decode_bool,
    decode_bytes32,
    decode_token_launched_log,
    decode_uint256,
    encode_launch_enabled_call,
    encode_launch_fee_call,
    encode_launch_token_call,
    encode_preview_economics_call,
    find_token_launched_log,
    require_eth_address,
)
from axiom_scanner.chain.rpc_client import RpcClient, RpcError
from axiom_scanner.chain.sponsor_wallet import (
    SponsorWalletError,
    send_sponsored_call,
    sponsor_address,
    sponsor_enabled,
    sponsor_private_key,
    wait_for_receipt,
)
from axiom_scanner.http_client import HttpClient
from axiom_scanner.security.fields import (
    DESCRIPTION_LAUNCH_MAX,
    DESCRIPTION_LAUNCH_MIN,
    FieldError,
    require_description,
    require_name,
    require_optional_telegram,
    require_optional_twitter,
    require_optional_website,
    require_ticker,
)
from axiom_scanner.security.query import safe_image_url
from vercel_api.launch_config import chain_rpc_url, explorer_url, launchpad_address

DEFAULT_LAUNCH_CONFIG_ID = 0
MAX_CREATOR_TAX_BPS = 1000

RATE_LIMIT = 5
RATE_WINDOW_SECONDS = 3600

_HITS: dict[str, list[float]] = defaultdict(list)


class SponsorLaunchError(RuntimeError):
    def __init__(self, message: str, code: str) -> None:
        super().__init__(message)
        self.code = code


def reset_sponsor_launch_limits() -> None:
    _HITS.clear()


def _rate_limited(client_ip: str, *, now: float) -> bool:
    ip = client_ip or "unknown"
    hits = [t for t in _HITS[ip] if now - t < RATE_WINDOW_SECONDS]
    hits.append(now)
    _HITS[ip] = hits
    return len(hits) > RATE_LIMIT


def sponsor_launch_status() -> dict[str, Any]:
    """Public, non-secret status the review screen can show before submitting."""
    configured = sponsor_enabled() and bool(sponsor_private_key())
    return {
        "available": configured,
        "sponsor_address": sponsor_address() if configured else None,
    }


def sponsor_launch_route(
    body: dict[str, Any],
    client_ip: str,
    *,
    http: Any = None,
    now: float | None = None,
) -> dict[str, Any]:
    stamp = now if now is not None else time.time()

    if not sponsor_enabled():
        raise SponsorLaunchError("Sponsored launch is not enabled.", "SPONSOR_DISABLED")
    if not sponsor_private_key():
        raise SponsorLaunchError("Sponsored launch is not configured.", "SPONSOR_UNCONFIGURED")
    if _rate_limited(client_ip, now=stamp):
        raise SponsorLaunchError(
            "Too many sponsored launches from this connection. Try again later.", "RATE_LIMITED"
        )

    fields = _validate_body(body)

    client = http or HttpClient(timeout_seconds=20, retries=1)
    rpc = RpcClient(chain_rpc_url(), client)
    factory = launchpad_address()

    try:
        code = rpc.get_code(factory)
        if not code or code == "0x":
            raise SponsorLaunchError("The launch contract has no code. Refusing to launch.", "CONTRACT_MISSING")

        fee_wei = decode_uint256(rpc.eth_call({"to": factory, "data": "0x" + encode_launch_fee_call().hex()}))
        enabled = decode_bool(rpc.eth_call({"to": factory, "data": "0x" + encode_launch_enabled_call().hex()}))
        if not enabled:
            raise SponsorLaunchError("Launching is currently disabled on the factory.", "LAUNCH_DISABLED")

        economics = decode_bytes32(
            rpc.eth_call(
                {
                    "to": factory,
                    "data": "0x"
                    + encode_preview_economics_call(DEFAULT_LAUNCH_CONFIG_ID, ZERO_ADDRESS).hex(),
                }
            )
        )
    except RpcError as exc:
        raise SponsorLaunchError(f"Could not read live launch terms: {exc}", "RPC_UNAVAILABLE") from exc

    payer = sponsor_address()
    if not payer:
        raise SponsorLaunchError("Sponsored launch is not configured.", "SPONSOR_UNCONFIGURED")
    balance = rpc.get_balance(payer)
    if balance < fee_wei:
        raise SponsorLaunchError(
            "The sponsor wallet does not have enough ETH to cover the launch fee right now.",
            "SPONSOR_INSUFFICIENT_BALANCE",
        )

    token_params = TokenParams(
        name=fields["name"],
        symbol=fields["ticker"],
        logo=fields["logo"],
        description=fields["description"],
        socials=Socials(**fields["socials"]),
        creator_fee_recipient=fields["creator_wallet"],
        creator_tax_bps=fields["creator_tax_bps"],
        buyback_enabled=fields["buyback_enabled"],
        expected_economics=economics,
        salt=secrets.token_bytes(32),
    )
    calldata = encode_launch_token_call(token_params, DEFAULT_LAUNCH_CONFIG_ID, ZERO_ADDRESS)

    try:
        rpc.eth_call(
            {
                "from": payer,
                "to": factory,
                "data": "0x" + calldata.hex(),
                "value": hex(fee_wei),
            }
        )
    except RpcError as exc:
        raise SponsorLaunchError(
            f"The launch did not simulate cleanly, so nothing was sent: {exc}", "SIMULATION_FAILED"
        ) from exc

    try:
        sent = send_sponsored_call(rpc, to=factory, data=calldata, value_wei=fee_wei)
    except SponsorWalletError as exc:
        raise SponsorLaunchError(str(exc), exc.code) from exc

    receipt = wait_for_receipt(rpc, sent.tx_hash)
    if receipt is None:
        return {
            "status": "pending",
            "tx_hash": sent.tx_hash,
            "explorer_url": f"{explorer_url()}/tx/{sent.tx_hash}",
        }

    if receipt.get("status") not in ("0x1", 1):
        raise SponsorLaunchError("The launch transaction reverted on-chain.", "LAUNCH_REVERTED")

    log = find_token_launched_log(receipt.get("logs") or [])
    if log is None:
        return {
            "status": "confirmed",
            "tx_hash": sent.tx_hash,
            "explorer_url": f"{explorer_url()}/tx/{sent.tx_hash}",
        }

    token, curve, deployer = decode_token_launched_log(log)
    return {
        "status": "confirmed",
        "tx_hash": sent.tx_hash,
        "token": token,
        "curve": curve,
        "deployer": deployer,
        "explorer_url": f"{explorer_url()}/token/{token}",
    }


def _validate_body(body: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(body, dict):
        raise SponsorLaunchError("Request body must be JSON.", "INVALID_INPUT")
    try:
        name = require_name(body.get("name"))
        ticker = require_ticker(body.get("ticker"))
        description = require_description(
            body.get("description"), min_len=DESCRIPTION_LAUNCH_MIN, max_len=DESCRIPTION_LAUNCH_MAX
        )
    except FieldError as exc:
        raise SponsorLaunchError(str(exc), "INVALID_INPUT") from exc

    logo = safe_image_url(body.get("logo"))
    if not logo:
        raise SponsorLaunchError("A logo image URL is required.", "INVALID_INPUT")

    raw_socials = body.get("socials") if isinstance(body.get("socials"), dict) else {}
    try:
        twitter = require_optional_twitter(raw_socials.get("twitter"))
        telegram = require_optional_telegram(raw_socials.get("telegram"))
        website = require_optional_website(raw_socials.get("website"))
        discord = require_optional_website(raw_socials.get("discord"))
        farcaster = require_optional_website(raw_socials.get("farcaster"))
    except FieldError as exc:
        raise SponsorLaunchError(str(exc), "INVALID_INPUT") from exc

    try:
        creator_wallet = require_eth_address(body.get("creator_wallet"))
    except EthAddressError as exc:
        raise SponsorLaunchError(str(exc), "INVALID_INPUT") from exc

    raw_tax = body.get("creator_tax_bps", 0)
    try:
        creator_tax_bps = int(raw_tax)
    except (TypeError, ValueError) as exc:
        raise SponsorLaunchError("Creator tax must be a whole number of basis points.", "INVALID_INPUT") from exc
    if creator_tax_bps < 0 or creator_tax_bps > MAX_CREATOR_TAX_BPS:
        raise SponsorLaunchError(
            f"Creator tax must be between 0 and {MAX_CREATOR_TAX_BPS} basis points.", "INVALID_INPUT"
        )

    buyback_enabled = bool(body.get("buyback_enabled", False))

    return {
        "name": name,
        "ticker": ticker,
        "description": description,
        "logo": logo,
        "socials": {
            "twitter": twitter,
            "telegram": telegram,
            "discord": discord,
            "website": website,
            "farcaster": farcaster,
        },
        "creator_wallet": creator_wallet,
        "creator_tax_bps": creator_tax_bps,
        "buyback_enabled": buyback_enabled,
    }
