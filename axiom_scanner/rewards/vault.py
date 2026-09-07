from __future__ import annotations

"""
The vault: what it holds, and paying it out.

Everything reported here is read from the chain at request time. There is no
stored balance and no running total kept in a file, because a number the
server could edit is a number nobody should trust for money. The vault's
balance is its wallet balance; what it has paid out is the transfers it has
sent. Both are checkable by anyone with the address.

Payouts are ordinary transfers from that wallet, which means this is a
custodial arrangement: holders are trusting Fons to actually send. That is a
real difference from a contract that distributes on its own, and the site
says so rather than implying otherwise.
"""

import time
from dataclasses import dataclass
from typing import Any

from eth_utils import keccak

from axiom_scanner.chain.rpc_client import RpcClient, RpcError
from axiom_scanner.chain.sponsor_wallet import (
    SponsorWalletError,
    send_sponsored_call,
    sponsor_address,
    sponsor_private_key,
)
from axiom_scanner.rewards.config import (
    creator_fee_bps,
    distributor_address,
    min_payout_wei,
    platform_token_address,
    rewards_enabled,
    vault_address,
)
from axiom_scanner.rewards.holders import snapshot_holders

TRANSFER_TOPIC = "0x" + keccak(text="Transfer(address,address,uint256)").hex()
DEFAULT_PAYOUT_BATCH = 25


class VaultError(RuntimeError):
    def __init__(self, message: str, code: str) -> None:
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class VaultState:
    live: bool
    token: str
    vault: str
    balance_wei: int
    creator_fee_bps: int
    holder_count: int
    complete_scan: bool
    block_number: int


def read_vault_state(rpc: RpcClient, *, include_holders: bool = True) -> dict[str, Any]:
    """Public state for the vault page. Every figure comes from the chain."""
    token = platform_token_address()
    vault = vault_address()

    """
    Collecting and distributing are separate states, and conflating them
    would misreport real money.

    The vault can be filling up long before $FONS exists -- that is the
    expected order of events. Reporting a zero balance just because there is
    no token yet would understate what the wallet actually holds, so the
    balance is read whenever there is a wallet to read, and the token only
    decides whether anything can be paid out.
    """
    if not vault:
        return {
            "live": False,
            "collecting": False,
            "reason": "no_vault",
            "token": token or None,
            "vault": None,
            "balance_wei": "0",
            "creator_fee_bps": creator_fee_bps(),
            "holder_count": 0,
            "complete_scan": False,
            "block_number": 0,
            "distributed_wei": "0",
            "distributor": distributor_address() or None,
        }

    if not token:
        try:
            balance = rpc.get_balance(vault)
            block_number = int(rpc.call("eth_blockNumber", []), 16)
            distributed = read_distributed_total(rpc, vault)
        except RpcError as exc:
            raise VaultError(f"Could not read the vault: {exc}", "RPC_UNAVAILABLE") from exc
        return {
            "live": False,
            "collecting": creator_fee_bps() > 0,
            "reason": "no_token",
            "token": None,
            "vault": vault,
            "balance_wei": str(balance),
            "creator_fee_bps": creator_fee_bps(),
            "holder_count": 0,
            "complete_scan": False,
            "block_number": block_number,
            "distributed_wei": str(distributed),
            "distributor": distributor_address() or None,
        }

    try:
        balance = rpc.get_balance(vault)
        block_number = int(rpc.call("eth_blockNumber", []), 16)
    except RpcError as exc:
        raise VaultError(f"Could not read the vault: {exc}", "RPC_UNAVAILABLE") from exc

    holder_count = 0
    complete = False
    if include_holders:
        try:
            snap = snapshot_holders(rpc, token, exclude={vault})
            holder_count = snap.holder_count
            complete = snap.complete
            block_number = snap.block_number
        except RpcError:
            # Reporting zero holders would be a lie; the flag carries the doubt.
            holder_count = 0
            complete = False

    return {
        "live": True,
        "collecting": creator_fee_bps() > 0,
        "reason": None,
        "token": token,
        "vault": vault,
        "balance_wei": str(balance),
        "creator_fee_bps": creator_fee_bps(),
        "holder_count": holder_count,
        "complete_scan": complete,
        "block_number": block_number,
        "distributed_wei": str(read_distributed_total(rpc, vault)),
        "distributor": distributor_address() or None,
    }


def read_distributed_total(
    rpc: RpcClient, vault: str, *, max_chunks: int = 12, budget_seconds: float = 4.0
) -> int:
    """
    What the vault has actually paid out, summed from its own outgoing
    transfers. Bounded like every other scan here, so treat it as "at least
    this much" rather than an audited lifetime total.

    Two bounds, not one, because each chunk below is a sequential round trip
    and a dozen of them can outlast the request that asked for them.

    First: a wallet that has never sent a transaction cannot have paid
    anything out, so its nonce settles the question in one call. That is the
    entire job while the vault is still filling up and $FONS does not exist,
    which is exactly when this endpoint is polled most.

    Second: the scan stops when it runs out of time. Stopping early
    understates the total, which the paragraph above already allows for --
    running out of time on the platform returns nothing at all.
    """
    try:
        if rpc.get_transaction_count(vault) == 0:
            return 0
    except RpcError:
        pass
    try:
        latest = int(rpc.call("eth_blockNumber", []), 16)
    except RpcError:
        return 0
    total = 0
    cursor = latest
    deadline = time.monotonic() + budget_seconds
    for _ in range(max_chunks):
        if time.monotonic() >= deadline:
            break
        start = max(0, cursor - 2000 + 1)
        try:
            logs = rpc.call(
                "eth_getLogs",
                [
                    {
                        "fromBlock": hex(start),
                        "toBlock": hex(cursor),
                        "topics": [TRANSFER_TOPIC, "0x" + vault[2:].rjust(64, "0")],
                    }
                ],
            )
        except RpcError:
            break
        for log in logs or []:
            data = str(log.get("data") or "0x")
            try:
                total += int(data, 16)
            except ValueError:
                continue
        if start == 0:
            break
        cursor = start - 1
    return total


def plan_distribution(rpc: RpcClient, amount_wei: int) -> dict[str, Any]:
    """
    Work out who gets what, without sending anything.

    Deliberately separate from execution so the split can be inspected -- and
    tested -- before any value moves.
    """
    if not rewards_enabled():
        raise VaultError("Rewards are not configured yet.", "NOT_CONFIGURED")
    if amount_wei <= 0:
        raise VaultError("Nothing to distribute.", "NOTHING_TO_DISTRIBUTE")

    token = platform_token_address()
    vault = vault_address()
    balance = rpc.get_balance(vault)
    if amount_wei > balance:
        raise VaultError("The vault does not hold that much.", "INSUFFICIENT_VAULT_BALANCE")

    snap = snapshot_holders(rpc, token, exclude={vault})
    if snap.total_supply_held <= 0:
        raise VaultError("No holders were found to distribute to.", "NO_HOLDERS")
    """
    Refuse to pay out from a partial holder list.

    A bounded scan covers only recent blocks, and on a chain this fast that
    can be a few hours. Anyone who bought before that window would be absent
    from the snapshot, so the split would quietly hand their share to
    everybody else. Set FONS_TOKEN_START_BLOCK to the token's first block and
    the scan covers its whole history; until then this refuses rather than
    underpaying people who cannot see that it happened.
    """
    if not snap.complete:
        raise VaultError(
            "The holder list is incomplete, so a distribution now could miss holders. "
            "Set FONS_TOKEN_START_BLOCK to the token's first block and try again.",
            "INCOMPLETE_HOLDER_SCAN",
        )

    from axiom_scanner.rewards.holders import compute_shares

    payouts = compute_shares(snap, amount_wei, min_payout=min_payout_wei())
    if not payouts:
        raise VaultError(
            "Every share would be smaller than the gas needed to send it.", "ALL_SHARES_DUST"
        )
    return {
        "token": token,
        "vault": vault,
        "block_number": snap.block_number,
        "holder_count": snap.holder_count,
        "complete_scan": snap.complete,
        "amount_wei": str(amount_wei),
        "assigned_wei": str(sum(payouts.values())),
        "recipient_count": len(payouts),
        "payouts": [{"address": a, "amount_wei": str(v)} for a, v in sorted(payouts.items())],
    }


def execute_distribution(
    rpc: RpcClient, plan: dict[str, Any], *, batch_limit: int = DEFAULT_PAYOUT_BATCH
) -> dict[str, Any]:
    """
    Send the planned payouts, one transfer each, bounded per call.

    A partial run is a normal outcome, not a failure: the sends that landed
    are reported with their hashes and the rest can be sent by calling again.
    Nothing here retries blindly, because a retry that cannot tell a timeout
    from a success is how people get paid twice.
    """
    if not sponsor_private_key():
        raise VaultError("The distributing wallet is not configured.", "NO_WALLET")
    payer = sponsor_address()
    if not payer or payer.lower() != str(plan.get("vault", "")).lower():
        raise VaultError(
            "The configured wallet is not the vault this plan was built for.", "WALLET_MISMATCH"
        )

    sent: list[dict[str, str]] = []
    failed: list[dict[str, str]] = []
    for item in plan.get("payouts", [])[:batch_limit]:
        address = str(item["address"])
        amount = int(item["amount_wei"])
        try:
            result = send_sponsored_call(rpc, to=address, data=b"", value_wei=amount)
            sent.append({"address": address, "amount_wei": str(amount), "tx_hash": result.tx_hash})
        except SponsorWalletError as exc:
            failed.append({"address": address, "amount_wei": str(amount), "error": str(exc)})
            break
    return {
        "sent": sent,
        "failed": failed,
        "remaining": max(0, len(plan.get("payouts", [])) - len(sent)),
        "completed_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
