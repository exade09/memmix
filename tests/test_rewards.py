from __future__ import annotations

import json
import os
import unittest
from typing import Any

from eth_utils import keccak

from axiom_scanner.chain.rpc_client import RpcClient
from axiom_scanner.rewards.config import creator_fee_bps, platform_token_address, rewards_enabled, vault_address
from axiom_scanner.rewards.holders import HolderSnapshot, compute_shares, snapshot_holders
from axiom_scanner.rewards.vault import VaultError, plan_distribution, read_vault_state
from vercel_api.dispatch import handle_api_get, handle_api_post
from vercel_api.routes.rewards import reset_rewards_limits

TOKEN = "0x1111111111111111111111111111111111111111"
VAULT = "0x2222222222222222222222222222222222222222"
ALICE = "0xAAAA000000000000000000000000000000000001"
BOB = "0xBBBB000000000000000000000000000000000002"
CAROL = "0xCCCC000000000000000000000000000000000003"

TRANSFER_TOPIC = "0x" + keccak(text="Transfer(address,address,uint256)").hex()


def _topic(addr: str) -> str:
    return "0x" + addr[2:].lower().rjust(64, "0")


class FakeChain:
    """A chain with three holders, answering only what these paths ask for."""

    def __init__(self, balances: dict[str, int] | None = None, vault_balance: int = 10**18) -> None:
        self.balances = balances if balances is not None else {ALICE: 600, BOB: 300, CAROL: 100}
        self.vault_balance = vault_balance
        self.sent: list[dict[str, Any]] = []
        # When true, transfers sit below the scan window, so the scan cannot
        # reach the token's start and must report itself incomplete.
        self.deep_history = False
        # Addresses that should answer eth_getCode with bytecode.
        self.contracts: set[str] = set()
        # Outgoing transactions the vault has ever sent. Zero means the
        # payout scan can be skipped entirely.
        self.vault_nonce = 0
        self.calls: list[str] = []

    def post_json(self, url: str, payload: dict[str, Any], *, headers: dict[str, str] | None = None) -> Any:
        method = payload["method"]
        params = payload.get("params") or []
        rid = payload["id"]
        self.calls.append(method)

        def ok(result: Any) -> dict[str, Any]:
            return {"jsonrpc": "2.0", "id": rid, "result": result}

        if method == "eth_blockNumber":
            # A chain tip far above any bounded window, so a scan that does
            # not know the token's start block cannot reach genesis.
            return ok(hex(5_000_000 if self.deep_history else 1_000))
        if method == "eth_getBalance":
            return ok(hex(self.vault_balance))
        if method == "eth_getLogs":
            f = params[0]
            # Outgoing-transfer scan (vault as sender) returns nothing here.
            if len(f.get("topics") or []) > 1:
                return ok([])
            if self.deep_history:
                return ok([{"topics": [TRANSFER_TOPIC, _topic(TOKEN), _topic(a)], "data": "0x1"} for a in self.balances])
            if int(f["fromBlock"], 16) > 0:
                return ok([])
            return ok(
                [
                    {"topics": [TRANSFER_TOPIC, _topic(TOKEN), _topic(a)], "data": "0x1"}
                    for a in self.balances
                ]
            )
        if method == "eth_getTransactionCount":
            return ok(hex(self.vault_nonce))
        if method == "eth_getCode":
            who = str(params[0]).lower()
            return ok("0x60006000" if who in {c.lower() for c in self.contracts} else "0x")
        if method == "eth_call":
            data = params[0]["data"]
            who = "0x" + data[-40:]
            for addr, bal in self.balances.items():
                if addr.lower().endswith(who[2:].lower()[-8:]):
                    return ok("0x" + hex(bal)[2:].rjust(64, "0"))
            return ok("0x" + "0" * 64)
        raise AssertionError(f"unexpected method {method}")


def _rpc(chain: FakeChain) -> RpcClient:
    return RpcClient("https://example.invalid", chain)


class ShareMathTests(unittest.TestCase):
    """The part that decides who gets paid what."""

    def _snap(self, balances: dict[str, int]) -> HolderSnapshot:
        return HolderSnapshot(
            block_number=1,
            balances=balances,
            total_supply_held=sum(balances.values()),
            scanned_from_block=0,
            complete=True,
        )

    def test_split_is_proportional(self) -> None:
        snap = self._snap({ALICE: 600, BOB: 300, CAROL: 100})
        shares = compute_shares(snap, 1000)
        self.assertEqual(shares[ALICE], 600)
        self.assertEqual(shares[BOB], 300)
        self.assertEqual(shares[CAROL], 100)

    def test_never_pays_out_more_than_it_was_given(self) -> None:
        """Rounding must not be able to overdraw the vault."""
        for total in (7, 999, 10**18 + 1):
            snap = self._snap({ALICE: 333, BOB: 333, CAROL: 334})
            shares = compute_shares(snap, total)
            self.assertLessEqual(sum(shares.values()), total, f"overdrew on {total}")

    def test_dust_below_the_floor_is_skipped(self) -> None:
        snap = self._snap({ALICE: 999_999, BOB: 1})
        shares = compute_shares(snap, 1000, min_payout=10)
        self.assertIn(ALICE, shares)
        self.assertNotIn(BOB, shares, "a payout worth less than its gas should be skipped")

    def test_no_holders_pays_nobody(self) -> None:
        self.assertEqual(compute_shares(self._snap({}), 1000), {})

    def test_zero_amount_pays_nobody(self) -> None:
        self.assertEqual(compute_shares(self._snap({ALICE: 1}), 0), {})


class HolderSnapshotTests(unittest.TestCase):
    def test_snapshot_reads_balances_at_one_block(self) -> None:
        chain = FakeChain()
        snap = snapshot_holders(_rpc(chain), TOKEN, max_chunks=1)
        self.assertEqual(snap.block_number, 1000)
        self.assertEqual(snap.holder_count, 3)
        self.assertEqual(snap.total_supply_held, 1000)

    def test_contracts_are_not_paid(self) -> None:
        """
        Before graduation the bonding curve holds nearly the whole supply.
        Counting it as a holder would send almost the entire distribution to
        a contract that cannot spend it.
        """
        curve = "0xDDDD000000000000000000000000000000000004"
        chain = FakeChain(balances={ALICE: 100, curve: 999_900})
        chain.contracts = {curve}
        snap = snapshot_holders(_rpc(chain), TOKEN, max_chunks=1)
        held = {a.lower() for a in snap.balances}
        self.assertIn(ALICE.lower(), held)
        self.assertNotIn(curve.lower(), held, "the curve must not be treated as a holder")
        self.assertEqual(snap.total_supply_held, 100)

    def test_vault_is_excluded_from_its_own_distribution(self) -> None:
        chain = FakeChain(balances={ALICE: 500, VAULT: 500})
        snap = snapshot_holders(_rpc(chain), TOKEN, exclude={VAULT}, max_chunks=1)
        self.assertNotIn(VAULT, snap.balances)


class VaultConfigTests(unittest.TestCase):
    def setUp(self) -> None:
        for key in ("FONS_TOKEN_ADDRESS", "REWARDS_VAULT_ADDRESS", "SPONSORED_CREATOR_FEE_BPS"):
            os.environ.pop(key, None)

    def tearDown(self) -> None:
        for key in ("FONS_TOKEN_ADDRESS", "REWARDS_VAULT_ADDRESS", "SPONSORED_CREATOR_FEE_BPS"):
            os.environ.pop(key, None)

    def test_creator_fee_defaults_to_zero_and_is_capped(self) -> None:
        self.assertEqual(creator_fee_bps(), 0)
        os.environ["SPONSORED_CREATOR_FEE_BPS"] = "100"
        self.assertEqual(creator_fee_bps(), 100)
        os.environ["SPONSORED_CREATOR_FEE_BPS"] = "9999"
        self.assertEqual(creator_fee_bps(), 1000, "must not exceed the factory's 10% ceiling")
        os.environ["SPONSORED_CREATOR_FEE_BPS"] = "nonsense"
        self.assertEqual(creator_fee_bps(), 0)

    def test_a_non_address_ca_is_not_treated_as_a_token(self) -> None:
        """The CA reads 'TBA' until launch; that must not look configured."""
        os.environ.pop("FONS_TOKEN_ADDRESS", None)
        self.assertFalse(platform_token_address().startswith("0x") and len(platform_token_address()) == 42)

    def test_explicit_env_addresses_win(self) -> None:
        os.environ["FONS_TOKEN_ADDRESS"] = TOKEN
        os.environ["REWARDS_VAULT_ADDRESS"] = VAULT
        self.assertEqual(platform_token_address(), TOKEN)
        self.assertEqual(vault_address(), VAULT)
        self.assertTrue(rewards_enabled())


class PayoutScanCostTests(unittest.TestCase):
    """
    Reading the vault has to fit inside one request.

    The outgoing-payout scan walks the chain backwards a chunk at a time, and
    every chunk is its own sequential round trip. Left unbounded that is slow
    enough to kill the request on the platform, which is not a slow page --
    it is a 500 where the balance used to be.
    """

    def setUp(self) -> None:
        reset_rewards_limits()
        os.environ["REWARDS_VAULT_ADDRESS"] = VAULT
        os.environ.pop("FONS_TOKEN_ADDRESS", None)

    def tearDown(self) -> None:
        for key in ("REWARDS_VAULT_ADDRESS", "FONS_TOKEN_ADDRESS"):
            os.environ.pop(key, None)

    def test_a_vault_that_never_sent_anything_is_not_scanned(self) -> None:
        chain = FakeChain()
        chain.vault_nonce = 0
        state = read_vault_state(_rpc(chain), include_holders=False)
        self.assertEqual(state["distributed_wei"], "0")
        self.assertEqual(
            [m for m in chain.calls if m == "eth_getLogs"],
            [],
            "a wallet with no outgoing transactions has provably paid out "
            "nothing, so scanning for its payments is pure latency",
        )

    def test_a_vault_that_has_sent_something_is_still_scanned(self) -> None:
        """The short circuit must not become a permanent excuse to skip."""
        chain = FakeChain()
        chain.vault_nonce = 3
        read_vault_state(_rpc(chain), include_holders=False)
        self.assertTrue(any(m == "eth_getLogs" for m in chain.calls))

    def test_the_scan_stops_when_it_runs_out_of_time(self) -> None:
        chain = FakeChain()
        chain.vault_nonce = 3
        from axiom_scanner.rewards.vault import read_distributed_total

        # A budget already spent: the first chunk boundary must end it.
        total = read_distributed_total(_rpc(chain), VAULT, budget_seconds=-1.0)
        self.assertEqual(total, 0)
        self.assertEqual(
            [m for m in chain.calls if m == "eth_getLogs"],
            [],
            "an exhausted budget must stop the scan rather than run it out",
        )


class VaultStateTests(unittest.TestCase):
    def setUp(self) -> None:
        reset_rewards_limits()
        os.environ["FONS_TOKEN_ADDRESS"] = TOKEN
        os.environ["REWARDS_VAULT_ADDRESS"] = VAULT
        os.environ["ADMIN_CA_PASSWORD"] = "unit-test-password"

    def tearDown(self) -> None:
        for key in (
            "FONS_TOKEN_ADDRESS",
            "REWARDS_VAULT_ADDRESS",
            "ADMIN_CA_PASSWORD",
            "SPONSORED_CREATOR_FEE_BPS",
            "SPONSOR_WALLET_PRIVATE_KEY",
        ):
            os.environ.pop(key, None)

    def test_state_reports_chain_values(self) -> None:
        chain = FakeChain(vault_balance=5 * 10**17)
        state = read_vault_state(_rpc(chain))
        self.assertTrue(state["live"])
        self.assertEqual(state["balance_wei"], str(5 * 10**17))
        self.assertEqual(state["vault"], VAULT)

    def test_without_a_token_it_still_reports_the_real_balance(self) -> None:
        """
        The vault fills up before $FONS exists, which is the expected order.
        Reporting zero then would understate money the wallet really holds;
        only payouts are blocked, not the balance.
        """
        os.environ.pop("FONS_TOKEN_ADDRESS", None)
        chain = FakeChain(vault_balance=10**18)
        state = read_vault_state(_rpc(chain), include_holders=False)
        self.assertFalse(state["live"], "no token means nothing can be paid out")
        self.assertEqual(state["reason"], "no_token")
        self.assertEqual(state["balance_wei"], str(10**18), "the balance is real and must be shown")

    def test_without_a_vault_wallet_nothing_is_reported(self) -> None:
        os.environ.pop("FONS_TOKEN_ADDRESS", None)
        os.environ.pop("REWARDS_VAULT_ADDRESS", None)
        os.environ["SPONSOR_WALLET_PRIVATE_KEY"] = ""
        state = read_vault_state(_rpc(FakeChain()), include_holders=False)
        self.assertFalse(state["live"])
        self.assertEqual(state["reason"], "no_vault")
        self.assertEqual(state["balance_wei"], "0")

    def test_collecting_reflects_whether_the_fee_is_on(self) -> None:
        os.environ.pop("SPONSORED_CREATOR_FEE_BPS", None)
        chain = FakeChain()
        self.assertFalse(read_vault_state(_rpc(chain), include_holders=False)["collecting"])
        os.environ["SPONSORED_CREATOR_FEE_BPS"] = "100"
        try:
            self.assertTrue(read_vault_state(_rpc(chain), include_holders=False)["collecting"])
        finally:
            os.environ.pop("SPONSORED_CREATOR_FEE_BPS", None)

    def test_plan_refuses_to_distribute_more_than_the_vault_holds(self) -> None:
        chain = FakeChain(vault_balance=100)
        with self.assertRaises(VaultError) as ctx:
            plan_distribution(_rpc(chain), 10**18)
        self.assertEqual(ctx.exception.code, "INSUFFICIENT_VAULT_BALANCE")

    def test_plan_splits_across_holders(self) -> None:
        chain = FakeChain(vault_balance=10**18)
        amount = 10**17  # 0.1 ETH, comfortably above the dust floor
        plan = plan_distribution(_rpc(chain), amount)
        self.assertEqual(plan["recipient_count"], 3)
        self.assertLessEqual(int(plan["assigned_wei"]), amount)

    def test_plan_refuses_on_an_incomplete_holder_scan(self) -> None:
        """
        A bounded scan can miss anyone who bought before the window, and their
        share would silently go to everybody else. Refusing is the only safe
        answer, so this is the guard that must not regress.
        """
        chain = FakeChain(vault_balance=10**18)
        chain.deep_history = True
        with self.assertRaises(VaultError) as ctx:
            plan_distribution(_rpc(chain), 10**17)
        self.assertEqual(ctx.exception.code, "INCOMPLETE_HOLDER_SCAN")

    def test_plan_refuses_when_every_share_would_be_dust(self) -> None:
        """Paying out less than the gas it costs would drain the vault for nothing."""
        chain = FakeChain(vault_balance=10**18)
        with self.assertRaises(VaultError) as ctx:
            plan_distribution(_rpc(chain), 100)
        self.assertEqual(ctx.exception.code, "ALL_SHARES_DUST")

    def test_public_endpoint_needs_no_password(self) -> None:
        status, payload = handle_api_get("/api/vault", "holders=0")
        self.assertEqual(status, 200)
        self.assertTrue(payload["success"])

    def test_distribution_requires_the_password(self) -> None:
        status, payload = handle_api_post(
            "/api/admin/vault/distribute",
            read_body=lambda max_bytes: {"password": "wrong", "amount_wei": "1000"},
            client_ip="10.9.9.1",
        )
        self.assertEqual(status, 401)
        self.assertEqual(payload["error"]["code"], "WRONG_PASSWORD")

    def test_password_is_never_echoed_back(self) -> None:
        status, payload = handle_api_post(
            "/api/admin/vault/plan",
            read_body=lambda max_bytes: {"password": "unit-test-password", "amount_wei": "0"},
            client_ip="10.9.9.2",
        )
        self.assertNotIn("unit-test-password", json.dumps(payload))


if __name__ == "__main__":
    unittest.main()
