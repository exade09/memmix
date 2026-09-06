from __future__ import annotations

import unittest

from axiom_scanner.rewards.merkle import build_distribution, leaf_hash, verify

ALICE = "0xAAaA000000000000000000000000000000000001"
BOB = "0xbBbB000000000000000000000000000000000002"
CAROL = "0xCcCc000000000000000000000000000000000003"

"""
Roots and proofs pinned against OpenZeppelin's JavaScript StandardMerkleTree,
which is what the deployed contract verifies against.

These are not self-generated: they were produced by @openzeppelin/merkle-tree
1.0.8 and pasted in. An implementation that is merely self-consistent would
still have every claim revert on chain, so the only useful check is against
the other side.
"""

JS_ROOT_THREE = "0xcbf8e10372d3b62a529496889ed223c73cde24664da580f018504b89976f5f8b"
# Leaf for (index 0, ALICE, 6e18) -- also the root of a one-entry tree.
JS_LEAF_ALICE_6E18 = "0x93db6d9ad1bf0770e9fab168f9ace37f3f29506a708f26c1e1776b6d79082128"
JS_ROOT_FIVE_ADDRESSES = {
    "0x1111111111111111111111111111111111111111": 1,
    "0x2222222222222222222222222222222222222222": 22,
    "0x3333333333333333333333333333333333333333": 333,
    "0x4444444444444444444444444444444444444444": 4444,
    "0x5555555555555555555555555555555555555555": 55555,
}
JS_PROOF_ALICE_THREE = [
    "0x1a48f0dcfb7be3a85af7b98710caa8789a69d7ef6457a72652e1b74806046dec",
    "0xafa27834420e4680144973ec80b305ee68cb35295f1f5091ae65b541b6d0c525",
]


class MerkleCompatibilityTests(unittest.TestCase):
    def test_leaf_hash_matches_javascript(self) -> None:
        # A single-entry tree's root is just that leaf's hash.
        self.assertEqual("0x" + leaf_hash(0, ALICE, 6 * 10**18).hex(), JS_LEAF_ALICE_6E18)

    def test_root_matches_javascript(self) -> None:
        dist = build_distribution({ALICE: 6 * 10**18, BOB: 3 * 10**18, CAROL: 1 * 10**18})
        self.assertEqual(dist.root, JS_ROOT_THREE)

    def test_proof_matches_javascript(self) -> None:
        dist = build_distribution({ALICE: 6 * 10**18, BOB: 3 * 10**18, CAROL: 1 * 10**18})
        self.assertEqual(dist.entries[ALICE].proof, JS_PROOF_ALICE_THREE)

    def test_addresses_are_ordered_case_insensitively(self) -> None:
        """
        A plain string sort puts every capital ahead of every lowercase
        letter, so "0xCc..." would come before "0xbB...". That changes each
        entry's index, the index is part of the leaf, and the root then
        disagrees with anyone else who recomputes it.
        """
        dist = build_distribution({ALICE: 6 * 10**18, BOB: 3 * 10**18, CAROL: 1 * 10**18})
        self.assertEqual(dist.entries[ALICE].index, 0)
        self.assertEqual(dist.entries[BOB].index, 1)
        self.assertEqual(dist.entries[CAROL].index, 2)

    def test_odd_leaf_counts_are_handled(self) -> None:
        dist = build_distribution(JS_ROOT_FIVE_ADDRESSES)
        self.assertEqual(len(dist.entries), 5)
        for entry in dist.entries.values():
            self.assertTrue(verify(dist.root, entry), f"{entry.account} failed to verify")


class MerkleBehaviourTests(unittest.TestCase):
    def test_total_equals_the_sum_of_entries(self) -> None:
        payouts = {ALICE: 6, BOB: 3, CAROL: 1}
        dist = build_distribution(payouts)
        self.assertEqual(dist.total, 10)
        self.assertEqual(sum(e.amount for e in dist.entries.values()), 10)

    def test_zero_amounts_are_dropped(self) -> None:
        dist = build_distribution({ALICE: 10, BOB: 0})
        self.assertIn(ALICE, dist.entries)
        self.assertNotIn(BOB, dist.entries, "a zero payout should not occupy a leaf")

    def test_empty_payouts_produce_an_empty_root(self) -> None:
        dist = build_distribution({})
        self.assertEqual(dist.total, 0)
        self.assertEqual(dist.entries, {})

    def test_the_same_payouts_always_produce_the_same_root(self) -> None:
        """A round nobody else can reproduce cannot be checked by anybody."""
        a = build_distribution({ALICE: 6, BOB: 3, CAROL: 1})
        b = build_distribution({CAROL: 1, ALICE: 6, BOB: 3})
        self.assertEqual(a.root, b.root)

    def test_a_tampered_amount_fails_verification(self) -> None:
        from dataclasses import replace

        dist = build_distribution({ALICE: 6, BOB: 3, CAROL: 1})
        tampered = replace(dist.entries[ALICE], amount=999)
        self.assertFalse(verify(dist.root, tampered))


if __name__ == "__main__":
    unittest.main()


class RoundStorageTests(unittest.TestCase):
    """Rounds are stored as payouts only; proofs are rebuilt on demand."""

    def setUp(self) -> None:
        import axiom_scanner.rewards.rounds as rounds_mod
        from pathlib import Path
        import tempfile

        self._mod = rounds_mod
        self._original = rounds_mod.ROUNDS_FILE
        self._tmp = Path(tempfile.mkdtemp()) / "reward_rounds.json"
        rounds_mod.ROUNDS_FILE = self._tmp

    def tearDown(self) -> None:
        self._mod.ROUNDS_FILE = self._original

    def test_a_recorded_round_yields_a_verifiable_proof(self) -> None:
        from axiom_scanner.rewards.merkle import verify, MerkleEntry

        payouts = {ALICE: 6 * 10**18, BOB: 3 * 10**18, CAROL: 1 * 10**18}
        dist = build_distribution(payouts)
        self._mod.add_round(
            round_id=0,
            asset="0x" + "0" * 40,
            asset_symbol="ETH",
            asset_decimals=18,
            payouts=payouts,
            snapshot_block=123,
            root=dist.root,
            total=dist.total,
        )

        claims = self._mod.claims_for(ALICE)
        self.assertEqual(len(claims), 1)
        claim = claims[0]
        self.assertEqual(claim["amount_wei"], str(6 * 10**18))

        rebuilt = MerkleEntry(
            index=claim["index"],
            account=claim["account"],
            amount=int(claim["amount_wei"]),
            proof=claim["proof"],
        )
        self.assertTrue(verify(dist.root, rebuilt), "the rebuilt proof must verify against the on-chain root")

    def test_lookup_is_case_insensitive_but_the_leaf_is_not(self) -> None:
        """
        Wallets return addresses in arbitrary case, so lookup must be lenient
        -- but the proof has to be built from the exact recorded string, since
        the leaf hashes those bytes.
        """
        from axiom_scanner.rewards.merkle import verify, MerkleEntry

        payouts = {ALICE: 10}
        dist = build_distribution(payouts)
        self._mod.add_round(
            round_id=0, asset="0x" + "0" * 40, asset_symbol="ETH", asset_decimals=18,
            payouts=payouts, snapshot_block=1, root=dist.root, total=dist.total,
        )
        claims = self._mod.claims_for(ALICE.lower())
        self.assertEqual(len(claims), 1)
        self.assertEqual(claims[0]["account"], ALICE, "must return the recorded casing")
        entry = MerkleEntry(
            index=claims[0]["index"], account=claims[0]["account"],
            amount=int(claims[0]["amount_wei"]), proof=claims[0]["proof"],
        )
        self.assertTrue(verify(dist.root, entry))

    def test_an_unknown_address_gets_nothing(self) -> None:
        self.assertEqual(self._mod.claims_for("0x9999999999999999999999999999999999999999"), [])

    def test_a_round_id_cannot_be_recorded_twice(self) -> None:
        payouts = {ALICE: 10}
        dist = build_distribution(payouts)
        args = dict(
            round_id=0, asset="0x" + "0" * 40, asset_symbol="ETH", asset_decimals=18,
            payouts=payouts, snapshot_block=1, root=dist.root, total=dist.total,
        )
        self._mod.add_round(**args)
        with self.assertRaises(self._mod.RoundError):
            self._mod.add_round(**args)
