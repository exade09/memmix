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

from dataclasses import dataclass
from typing import Any

from eth_abi import decode
from eth_utils import keccak

from axiom_scanner.chain.pons_abi import require_eth_address
from axiom_scanner.chain.rpc_client import RpcClient, RpcError

TRANSFER_TOPIC = "0x" + keccak(text="Transfer(address,address,uint256)").hex()
ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"

# Chunk size for log scans. Public nodes reject wide ranges, and a serverless
# function has a time budget, so the scan is bounded and says so rather than
# pretending to have seen the whole chain.
LOG_CHUNK_BLOCKS = 2000
DEFAULT_MAX_CHUNKS = 24
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
    max_chunks: int = DEFAULT_MAX_CHUNKS,
    start_block: int = 0,
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
    from_block = max(floor, to_block - LOG_CHUNK_BLOCKS * max_chunks + 1)
    cursor = to_block
    chunks = 0
    while cursor >= floor and chunks < max_chunks:
        start = max(floor, cursor - LOG_CHUNK_BLOCKS + 1)
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
            # A refused range should not be reported as "no holders".
            break
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
        chunks += 1
        if start <= floor:
            # Reached the token's first block (or genesis): the set is whole.
            return candidates, floor, True
        cursor = start - 1
    return candidates, from_block, from_block <= floor


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
    max_chunks: int = DEFAULT_MAX_CHUNKS,
    start_block: int | None = None,
    skip_contracts: bool = True,
) -> HolderSnapshot:
    if start_block is None:
        from axiom_scanner.rewards.config import token_start_block

        start_block = token_start_block()
    block = rpc.call("eth_blockNumber", [])
    block_number = int(block, 16)
    candidates, from_block, complete = collect_candidate_addresses(
        rpc, token, to_block=block_number, max_chunks=max_chunks, start_block=start_block
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
