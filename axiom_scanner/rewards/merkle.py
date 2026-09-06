from __future__ import annotations

"""
Merkle trees for payout rounds, byte-compatible with OpenZeppelin's
StandardMerkleTree.

Compatibility is the whole point and the only real risk. The proofs built
here are verified on chain by OpenZeppelin's MerkleProof against a root this
code produced, so any difference in leaf encoding, pair ordering or tree
shape does not degrade gracefully -- every claim simply reverts. The rules
being matched are:

  leaf   = keccak256(keccak256(abi.encode(uint256,address,uint256)))
           (hashed twice, which is what makes a leaf unforgeable as an
           internal node)
  pair   = keccak256(sorted(left, right))
  leaves are sorted by hash before the tree is built

tests/test_merkle.py checks the output against the JavaScript library rather
than against itself, because a self-consistent implementation that disagrees
with the chain is exactly the failure this needs to catch.
"""

from dataclasses import dataclass
from typing import Any

from eth_abi import encode as abi_encode
from eth_utils import keccak

LEAF_TYPES = ["uint256", "address", "uint256"]


def leaf_hash(index: int, account: str, amount: int) -> bytes:
    """One entry, hashed the way StandardMerkleTree does it."""
    return keccak(keccak(abi_encode(LEAF_TYPES, [index, account, amount])))


def _hash_pair(a: bytes, b: bytes) -> bytes:
    # Sorted, so a proof does not need to say which side each sibling is on.
    return keccak(a + b) if a < b else keccak(b + a)


@dataclass(frozen=True)
class MerkleEntry:
    index: int
    account: str
    amount: int
    proof: list[str]

    def as_dict(self) -> dict[str, Any]:
        return {
            "index": self.index,
            "account": self.account,
            "amount_wei": str(self.amount),
            "proof": self.proof,
        }


@dataclass(frozen=True)
class MerkleDistribution:
    root: str
    total: int
    entries: dict[str, MerkleEntry]

    def as_dict(self) -> dict[str, Any]:
        return {
            "root": self.root,
            "total_wei": str(self.total),
            "recipient_count": len(self.entries),
            "entries": {a: e.as_dict() for a, e in self.entries.items()},
        }


def _build_tree(leaves: list[bytes]) -> list[bytes]:
    """
    The same flat array layout OpenZeppelin uses: leaves occupy the tail in
    reverse order, and each parent sits at (i - 1) // 2.
    """
    if not leaves:
        return []
    size = 2 * len(leaves) - 1
    tree: list[bytes] = [b""] * size
    for i, leaf in enumerate(leaves):
        tree[size - 1 - i] = leaf
    for i in range(size - 1 - len(leaves), -1, -1):
        tree[i] = _hash_pair(tree[2 * i + 1], tree[2 * i + 2])
    return tree


def _proof_for(tree: list[bytes], node_index: int) -> list[bytes]:
    proof: list[bytes] = []
    current = node_index
    while current > 0:
        sibling = current - 1 if current % 2 == 0 else current + 1
        if sibling < len(tree):
            proof.append(tree[sibling])
        current = (current - 1) // 2
    return proof


def build_distribution(payouts: dict[str, int]) -> MerkleDistribution:
    """
    Build a round from {address: amount}.

    Addresses are indexed in sorted order so the same payouts always produce
    the same tree: a round that cannot be reproduced cannot be checked by
    anyone else, which would defeat publishing the root at all.
    """
    """
    Order by the lowercased address, not the raw string.

    Checksummed addresses mix cases, and a plain string sort puts every
    capital ahead of every lowercase letter -- so "0xCc..." would sort before
    "0xbB...". That ordering decides each entry's index, the index goes into
    the leaf hash, and a different index means a different root than the one
    anybody else recomputing this would get.
    """
    items = [
        (addr, amount)
        for addr, amount in sorted(payouts.items(), key=lambda kv: kv[0].lower())
        if amount > 0
    ]
    if not items:
        return MerkleDistribution(root="0x" + "00" * 32, total=0, entries={})

    indexed = [(i, addr, amount) for i, (addr, amount) in enumerate(items)]
    hashed = [(leaf_hash(i, addr, amount), i, addr, amount) for i, addr, amount in indexed]
    # StandardMerkleTree sorts leaves by hash before building.
    hashed.sort(key=lambda item: item[0])

    leaves = [h[0] for h in hashed]
    tree = _build_tree(leaves)
    size = len(tree)

    entries: dict[str, MerkleEntry] = {}
    for position, (_, index, account, amount) in enumerate(hashed):
        node_index = size - 1 - position
        proof = ["0x" + node.hex() for node in _proof_for(tree, node_index)]
        entries[account] = MerkleEntry(index=index, account=account, amount=amount, proof=proof)

    return MerkleDistribution(
        root="0x" + tree[0].hex(),
        total=sum(amount for _, _, amount in indexed),
        entries=entries,
    )


def verify(root: str, entry: MerkleEntry) -> bool:
    """Recompute a proof locally, so a round can be checked before it is published."""
    node = leaf_hash(entry.index, entry.account, entry.amount)
    for step in entry.proof:
        node = _hash_pair(node, bytes.fromhex(step[2:]))
    return "0x" + node.hex() == root.lower()
