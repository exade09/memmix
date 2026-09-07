from __future__ import annotations

"""
Who holds the token, read off the chain rather than out of a database.

There is no holder list on an ERC-20; there are only Transfer events. So the
candidate set is every address that has ever received the token, and the
balance of each is then read back with balanceOf at a single block. Reading
balances rather than replaying transfer arithmetic means a missed or
reordered log cannot silently produce a wrong payout -- the worst it can do
is leave an address out of the candidate set, which is visible and fixable,
instead of paying someone the wrong amount.
"""

import time
from dataclasses import dataclass
from typing import Any

from eth_abi import decode
from eth_utils import keccak

from axiom_scanner.chain.pons_abi import require_eth_address
from axiom_scanner.chain.rpc_client import RpcClient, RpcError

TRANSFER_TOPIC = "0x" + keccak(text="Transfer(address,address,uint256)").hex()
ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"

"""
How wide a log scan reaches per call.

This chain produces roughly 857,000 blocks a day. At the 2,000-block step
this scan used to take, a single day of a token's history cost 428 sequential
round trips -- so the scan outgrew the request that asked for it within days
of a launch, and payouts would simply stop working.

The node is far more capable than that: it answers a 500,000-block range for
a token in under two seconds. So the span starts wide and adapts. A refused
or oversized range halves it and retries; a range that comes back small grows
it again. Busy tokens settle on a narrow span because their answers are big,
quiet ones stay wide, and neither is guessed at up front.

Two bounds still apply, because this runs inside one request: a call budget
and a wall-clock budget. Hitting either ends the scan and the snapshot
reports itself incomplete, which every caller that moves money refuses to act
on. Stopping early and saying so is the safe failure; timing out is not.
"""
MAX_LOG_SPAN_BLOCKS = 500_000
INITIAL_LOG_SPAN_BLOCKS = 100_000
# The old fixed step, kept as the floor: if the node will not answer even
# this, widening is not the problem.
MIN_LOG_SPAN_BLOCKS = 2_000
DEFAULT_MAX_CALLS = 400
DEFAULT_SCAN_BUDGET_SECONDS = 20.0
BALANCE_OF_SELECTOR = "0x" + keccak(text="balanceOf(address)")[:4].hex()


@dataclass(frozen=True)
class HolderSnapshot:
    """A view of who holds what, pinned to one block."""

    block_number: int
    balances: dict[str, int]
    total_supply_held: int
    scanned_from_block: int
    complete: bool

    @property
    def holder_count(self) -> int:
        return len(self.balances)


def _address_from_topic(topic: str) -> str:
    return require_eth_address("0x" + str(topic)[-40:])


def collect_candidate_addresses(
    rpc: RpcClient,
    token: str,
    *,
    to_block: int,
    start_block: int = 0,
    max_calls: int = DEFAULT_MAX_CALLS,
    budget_seconds: float = DEFAULT_SCAN_BUDGET_SECONDS,
) -> tuple[set[str], int, bool]:
    """
    Every address that has ever been sent the token, scanning backwards.

    Returns the candidates, the earliest block actually scanned, and whether
    the scan covered the token's whole history.

    `start_block` is the block the token was created in. With it, "complete"
    means what it says. Without it the scan is a bounded look at recent
    history and reports itself as incomplete -- which callers that move money
    must refuse to act on, because an address missing from the set is a
    holder who would be paid nothing.
    """
    candidates: set[str] = set()
    floor = max(0, start_block)
    cursor = to_block
    span = INITIAL_LOG_SPAN_BLOCKS
    calls = 0
    deadline = time.monotonic() + budget_seconds
    lowest = to_block + 1

    while cursor >= floor and calls < max_calls and time.monotonic() < deadline:
        start = max(floor, cursor - span + 1)
        try:
            logs = rpc.call(
                "eth_getLogs",
                [
                    {
                        "fromBlock": hex(start),
                        "toBlock": hex(cursor),
                        "address": token,
                        "topics": [TRANSFER_TOPIC],
                    }
                ],
            )
        except RpcError:
            calls += 1
            if span > MIN_LOG_SPAN_BLOCKS:
                # Almost always "range too wide" or "too many results".
                # Narrow and retry the same ground rather than skipping it:
                # a skipped range is a holder paid nothing.
                span = max(MIN_LOG_SPAN_BLOCKS, span // 4)
                continue
            # Refused even at the floor. A refused range must not be reported
            # as "no holders", so stop and let `complete` carry the doubt.
            break

        calls += 1
        received = len(logs or [])
        for log in logs or []:
            topics = log.get("topics") or []
            if len(topics) < 3:
                continue
            try:
                recipient = _address_from_topic(topics[2])
            except ValueError:
                continue
            if recipient != ZERO_ADDRESS:
                candidates.add(recipient)

        lowest = start
        if start <= floor:
            # Reached the token's first block (or genesis): the set is whole.
            return candidates, floor, True

        # A thin answer means there is room to reach further next time.
        if received < 500:
            span = min(MAX_LOG_SPAN_BLOCKS, span * 2)
        elif received > 5000:
            span = max(MIN_LOG_SPAN_BLOCKS, span // 2)
        cursor = start - 1

    return candidates, min(lowest, to_block), lowest <= floor


def is_contract(rpc: RpcClient, address: str) -> bool:
    try:
        code = rpc.call("eth_getCode", [address, "latest"])
    except RpcError:
        # Unknown is treated as "contract" here, because the caller uses this
        # to decide whether to send money: not sending is the safe mistake.
        return True
    return bool(code) and code != "0x"


def read_balances(
    rpc: RpcClient,
    token: str,
    addresses: set[str],
    *,
    block: int,
    exclude: set[str] | None = None,
    skip_contracts: bool = True,
) -> dict[str, int]:
    """
    Balances at one block, so every share is computed against the same state.

    Contracts are left out by default, and that is not a detail. Before a
    token graduates its bonding curve holds essentially the entire supply, so
    including contracts would hand almost the whole distribution to the curve
    -- an address that cannot spend it and, being unable to receive a plain
    transfer, may not even accept it. Pools, routers and lockers are the same
    story. What is wanted is people.
    """
    skip = {addr.lower() for addr in (exclude or set())}
    skip.add(ZERO_ADDRESS.lower())
    balances: dict[str, int] = {}
    for address in sorted(addresses):
        if address.lower() in skip:
            continue
        if skip_contracts and is_contract(rpc, address):
            continue
        try:
            raw = rpc.call(
                "eth_call",
                [
                    {"to": token, "data": BALANCE_OF_SELECTOR + address[2:].rjust(64, "0")},
                    hex(block),
                ],
            )
        except RpcError:
            continue
        try:
            value = decode(["uint256"], bytes.fromhex(str(raw)[2:]))[0]
        except Exception:
            continue
        if value > 0:
            balances[address] = value
    return balances


def snapshot_holders(
    rpc: RpcClient,
    token: str,
    *,
    exclude: set[str] | None = None,
    max_calls: int = DEFAULT_MAX_CALLS,
    budget_seconds: float = DEFAULT_SCAN_BUDGET_SECONDS,
    start_block: int | None = None,
    skip_contracts: bool = True,
) -> HolderSnapshot:
    if start_block is None:
        from axiom_scanner.rewards.config import token_start_block

        start_block = token_start_block()
    block = rpc.call("eth_blockNumber", [])
    block_number = int(block, 16)
    candidates, from_block, complete = collect_candidate_addresses(
        rpc,
        token,
        to_block=block_number,
        start_block=start_block,
        max_calls=max_calls,
        budget_seconds=budget_seconds,
    )
    balances = read_balances(
        rpc, token, candidates, block=block_number, exclude=exclude, skip_contracts=skip_contracts
    )
    return HolderSnapshot(
        block_number=block_number,
        balances=balances,
        total_supply_held=sum(balances.values()),
        scanned_from_block=from_block,
        complete=complete,
    )


def compute_shares(snapshot: HolderSnapshot, amount: int, *, min_payout: int = 0) -> dict[str, int]:
    """
    Split `amount` across holders in proportion to balance.

    Integer maths only, and the remainder from rounding is left in the vault
    rather than handed to whoever happens to sort first. Dust below
    `min_payout` is skipped, because sending it costs more gas than it is
    worth -- those holders keep their share of the next, larger distribution.
    """
    if amount <= 0 or snapshot.total_supply_held <= 0:
        return {}
    payouts: dict[str, int] = {}
    for address, balance in snapshot.balances.items():
        share = (amount * balance) // snapshot.total_supply_held
        if share >= min_payout and share > 0:
            payouts[address] = share
    return payouts


def summarize(snapshot: HolderSnapshot) -> dict[str, Any]:
    return {
        "block_number": snapshot.block_number,
        "holder_count": snapshot.holder_count,
        "scanned_from_block": snapshot.scanned_from_block,
        "complete_scan": snapshot.complete,
    }
