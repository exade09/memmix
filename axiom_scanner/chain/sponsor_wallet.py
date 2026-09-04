from __future__ import annotations

"""
The one place a private key ever exists in this codebase.

Everywhere else, "the wallet" means the visitor's own MetaMask: the app
builds and checks a transaction, only the visitor can sign it. This module
is the deliberate, narrow exception -- a server-held hot wallet that pays for
and submits a launch itself, for the sponsored-launch flow only. It never
touches token metadata beyond what it is told to encode, never reads or
stores a visitor's own key, and the key it does hold comes from one place:
the SPONSOR_WALLET_PRIVATE_KEY environment variable, set directly in the
hosting dashboard. It must never be logged, echoed in a response, or written
to a file.
"""

import os
import time
from dataclasses import dataclass
from typing import Any

from eth_account import Account

from .pons_abi import require_eth_address
from .rpc_client import RpcClient, RpcError

# A cap on what a single sponsored call will ever attach as msg.value, as a
# backstop against a misread fee value turning into an enormous transfer.
# The real launch fee is currently 0.0005 ETH; this is generous headroom,
# not a number anyone should expect to spend.
MAX_SPONSORED_VALUE_WEI = 10 ** 16  # 0.01 ETH

# Gas is padded 20% over the estimate so a slightly-off estimate does not
# turn into an out-of-gas revert that still burns the sponsor wallet's ETH.
GAS_ESTIMATE_PADDING_BPS = 12000

RECEIPT_POLL_ATTEMPTS = 10
RECEIPT_POLL_INTERVAL_SECONDS = 1.5


class SponsorWalletError(RuntimeError):
    def __init__(self, message: str, code: str) -> None:
        super().__init__(message)
        self.code = code


def sponsor_private_key() -> str:
    return (os.getenv("SPONSOR_WALLET_PRIVATE_KEY") or "").strip()


def sponsor_enabled() -> bool:
    raw = (os.getenv("ENABLE_SPONSORED_LAUNCH") or "").strip().lower()
    return raw in {"1", "true", "yes", "on"}


def sponsor_address() -> str | None:
    """The wallet's public address, safe to expose. None if unconfigured."""
    key = sponsor_private_key()
    if not key:
        return None
    try:
        return Account.from_key(key).address
    except (ValueError, TypeError):
        return None


@dataclass(frozen=True)
class SentTransaction:
    tx_hash: str
    from_address: str


def send_sponsored_call(
    rpc: RpcClient,
    *,
    to: str,
    data: bytes,
    value_wei: int,
) -> SentTransaction:
    """
    Sign and broadcast one call from the sponsor wallet. Read-only checks
    (fee terms, simulation) happen before this is ever reached; this
    function's only job is building a correctly-priced EIP-1559 transaction
    and sending it.
    """
    key = sponsor_private_key()
    if not key:
        raise SponsorWalletError("Sponsored launch is not configured.", "SPONSOR_UNCONFIGURED")
    if value_wei < 0 or value_wei > MAX_SPONSORED_VALUE_WEI:
        raise SponsorWalletError("Refusing to sponsor a transaction of that value.", "SPONSOR_VALUE_REJECTED")

    account = Account.from_key(key)
    to_address = require_eth_address(to)

    try:
        chain_id = rpc.chain_id()
        nonce = rpc.get_transaction_count(account.address)
        base_fee = rpc.base_fee_per_gas()
        priority_fee = rpc.max_priority_fee_per_gas()
        max_fee = base_fee * 2 + priority_fee
        gas_estimate = rpc.estimate_gas(
            {
                "from": account.address,
                "to": to_address,
                "data": "0x" + data.hex(),
                "value": hex(value_wei),
            }
        )
    except RpcError as exc:
        raise SponsorWalletError(f"Could not prepare the sponsored transaction: {exc}", "RPC_UNAVAILABLE") from exc

    gas_limit = (gas_estimate * GAS_ESTIMATE_PADDING_BPS) // 10000

    tx = {
        "chainId": chain_id,
        "nonce": nonce,
        "to": to_address,
        "value": value_wei,
        "data": data,
        "gas": gas_limit,
        "maxFeePerGas": max_fee,
        "maxPriorityFeePerGas": priority_fee,
        "type": 2,
    }

    signed = Account.sign_transaction(tx, key)
    raw = getattr(signed, "raw_transaction", None) or getattr(signed, "rawTransaction", None)
    if raw is None:
        raise SponsorWalletError("Could not sign the sponsored transaction.", "SIGN_FAILED")

    try:
        tx_hash = rpc.send_raw_transaction(bytes(raw))
    except RpcError as exc:
        raise SponsorWalletError(f"Broadcasting the sponsored transaction failed: {exc}", "SEND_FAILED") from exc

    return SentTransaction(tx_hash=tx_hash, from_address=account.address)


def wait_for_receipt(rpc: RpcClient, tx_hash: str) -> dict[str, Any] | None:
    """
    Bounded polling, not a long-lived wait: a serverless function has a
    real time budget, and a caller that gets back "still pending" with the
    hash can check the explorer rather than the request hanging.
    """
    for _ in range(RECEIPT_POLL_ATTEMPTS):
        receipt = rpc.get_transaction_receipt(tx_hash)
        if receipt is not None:
            return receipt
        time.sleep(RECEIPT_POLL_INTERVAL_SECONDS)
    return None
