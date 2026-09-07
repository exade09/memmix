from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path

import axiom_scanner.rewards.settings as settings_mod
from axiom_scanner.rewards.settings import SettingsError, validate
from vercel_api.dispatch import handle_api_get, handle_api_post
from vercel_api.routes.settings import reset_settings_rate_limit

TOKEN = "0x1111111111111111111111111111111111111111"
VAULT = "0x2222222222222222222222222222222222222222"
DISTRIBUTOR = "0x3333333333333333333333333333333333333333"
PASSWORD = "settings-test-password"


class SettingsFileTestCase(unittest.TestCase):
    """Each test gets its own settings file; none touch the repo's."""

    def setUp(self) -> None:
        reset_settings_rate_limit()
        self._original = settings_mod.SETTINGS_FILE
        self._tmp = Path(tempfile.mkdtemp()) / "settings.json"
        settings_mod.SETTINGS_FILE = self._tmp
        os.environ["ADMIN_CA_PASSWORD"] = PASSWORD

    def tearDown(self) -> None:
        settings_mod.SETTINGS_FILE = self._original
        for key in (
            "ADMIN_CA_PASSWORD",
            "FONS_TOKEN_ADDRESS",
            "FONS_TOKEN_START_BLOCK",
            "REWARDS_VAULT_ADDRESS",
            "REWARDS_DISTRIBUTOR_ADDRESS",
            "SPONSORED_CREATOR_FEE_BPS",
            "SPONSOR_WALLET_PRIVATE_KEY",
        ):
            os.environ.pop(key, None)

    def write(self, data: dict) -> None:
        self._tmp.write_text(json.dumps(data), encoding="utf-8")


class ValidationTests(SettingsFileTestCase):
    def test_an_address_that_is_not_an_address_is_refused(self) -> None:
        with self.assertRaises(SettingsError):
            validate({"rewards_distributor_address": "not-an-address"})

    def test_a_start_block_must_be_a_number(self) -> None:
        with self.assertRaises(SettingsError):
            validate({"fons_token_start_block": "soon"})

    def test_the_creator_fee_is_capped_at_the_factory_ceiling(self) -> None:
        """
        Above 1000 bps the launch reverts on chain. Refusing here means the
        message explains why, instead of every launch failing later.
        """
        with self.assertRaises(SettingsError) as ctx:
            validate({"creator_fee_bps": 1001})
        self.assertIn("1000", str(ctx.exception))
        self.assertEqual(validate({"creator_fee_bps": 1000})["creator_fee_bps"], 1000)

    def test_zero_fee_is_a_value_not_a_deletion(self) -> None:
        """Switching the fee off must be distinguishable from not setting it."""
        self.write({"creator_fee_bps": 50})
        self.assertEqual(validate({"creator_fee_bps": 0})["creator_fee_bps"], 0)

    def test_an_empty_field_clears_the_override(self) -> None:
        self.write({"rewards_vault_address": VAULT})
        self.assertNotIn("rewards_vault_address", validate({"rewards_vault_address": ""}))

    def test_an_untouched_field_is_left_alone(self) -> None:
        self.write({"rewards_vault_address": VAULT})
        result = validate({"creator_fee_bps": 10})
        self.assertEqual(result["rewards_vault_address"], VAULT)

    def test_an_unknown_key_is_refused_rather_than_stored(self) -> None:
        with self.assertRaises(SettingsError):
            validate({"admin_password_please": "x"})


class PrecedenceTests(SettingsFileTestCase):
    """Stored settings win; the environment is the fallback."""

    def test_stored_values_beat_the_environment(self) -> None:
        from axiom_scanner.rewards.config import (
            creator_fee_bps,
            distributor_address,
            platform_token_address,
            token_start_block,
            vault_address,
        )

        os.environ["FONS_TOKEN_ADDRESS"] = TOKEN
        os.environ["REWARDS_VAULT_ADDRESS"] = TOKEN
        os.environ["SPONSORED_CREATOR_FEE_BPS"] = "10"
        os.environ["FONS_TOKEN_START_BLOCK"] = "1"
        self.write(
            {
                "fons_token_address": DISTRIBUTOR,
                "rewards_vault_address": VAULT,
                "rewards_distributor_address": DISTRIBUTOR,
                "creator_fee_bps": 50,
                "fons_token_start_block": 999,
            }
        )
        self.assertEqual(platform_token_address(), DISTRIBUTOR)
        self.assertEqual(vault_address(), VAULT)
        self.assertEqual(distributor_address(), DISTRIBUTOR)
        self.assertEqual(creator_fee_bps(), 50)
        self.assertEqual(token_start_block(), 999)

    def test_the_environment_still_answers_when_nothing_is_stored(self) -> None:
        from axiom_scanner.rewards.config import creator_fee_bps, token_start_block

        os.environ["SPONSORED_CREATOR_FEE_BPS"] = "25"
        os.environ["FONS_TOKEN_START_BLOCK"] = "42"
        self.assertEqual(creator_fee_bps(), 25)
        self.assertEqual(token_start_block(), 42)

    def test_a_corrupt_file_reads_as_unconfigured_rather_than_raising(self) -> None:
        """
        A settings file that cannot be parsed must not take the site down, and
        must not be treated as "everything is fine". Unconfigured is the
        answer that keeps payouts refusing to run.
        """
        self._tmp.write_text("{not json", encoding="utf-8")
        from axiom_scanner.rewards.config import distributor_address

        self.assertEqual(distributor_address(), "")


class SettingsEndpointTests(SettingsFileTestCase):
    def test_the_public_endpoint_needs_no_password_and_leaks_nothing(self) -> None:
        self.write({"rewards_distributor_address": DISTRIBUTOR, "rewards_vault_address": VAULT})
        status, payload = handle_api_get("/api/settings", "")
        self.assertEqual(status, 200)
        self.assertEqual(payload["data"]["distributor"], DISTRIBUTOR)
        # The vault wallet is not the browser's business, and neither is the
        # password or anything else stored alongside it.
        self.assertNotIn("rewards_vault_address", json.dumps(payload))
        self.assertNotIn(PASSWORD, json.dumps(payload))

    def test_writing_requires_the_password(self) -> None:
        status, payload = handle_api_post(
            "/api/admin/settings",
            read_json=lambda max_bytes=0: {"password": "wrong", "creator_fee_bps": 100},
            client_ip="10.0.0.1",
        )
        self.assertEqual(status, 401)
        self.assertEqual(payload["error"]["code"], "WRONG_PASSWORD")
        self.assertFalse(self._tmp.exists(), "a rejected write must not create the file")

    def test_reading_the_panel_does_not_write(self) -> None:
        """
        The read and the write share a gate but not a code path. If opening the
        panel saved, merely looking would overwrite whatever was there.
        """
        self.write({"creator_fee_bps": 50})
        before = self._tmp.read_text(encoding="utf-8")
        status, payload = handle_api_post(
            "/api/admin/settings",
            read_json=lambda max_bytes=0: {"password": PASSWORD, "read_only": True},
            client_ip="10.0.0.2",
        )
        self.assertEqual(status, 200)
        self.assertEqual(payload["data"]["stored"]["creator_fee_bps"], 50)
        self.assertEqual(self._tmp.read_text(encoding="utf-8"), before)

    def test_a_write_round_trips_and_reports_what_is_in_effect(self) -> None:
        status, payload = handle_api_post(
            "/api/admin/settings",
            read_json=lambda max_bytes=0: {
                "password": PASSWORD,
                "rewards_distributor_address": DISTRIBUTOR,
                "fons_token_start_block": "12345",
            },
            client_ip="10.0.0.3",
        )
        self.assertEqual(status, 200)
        self.assertEqual(payload["data"]["effective"]["rewards_distributor_address"], DISTRIBUTOR)
        self.assertEqual(payload["data"]["effective"]["fons_token_start_block"], 12345)
        stored = json.loads(self._tmp.read_text(encoding="utf-8"))
        self.assertEqual(stored["fons_token_start_block"], 12345)
        self.assertIn("updated_at", stored)

    def test_the_password_is_never_stored_or_echoed(self) -> None:
        status, payload = handle_api_post(
            "/api/admin/settings",
            read_json=lambda max_bytes=0: {"password": PASSWORD, "creator_fee_bps": 10},
            client_ip="10.0.0.4",
        )
        self.assertEqual(status, 200)
        self.assertNotIn(PASSWORD, json.dumps(payload))
        self.assertNotIn(PASSWORD, self._tmp.read_text(encoding="utf-8"))

    def test_an_invalid_value_is_rejected_without_saving_the_rest(self) -> None:
        """A partly applied save would leave settings in a state nobody chose."""
        self.write({"creator_fee_bps": 50})
        status, payload = handle_api_post(
            "/api/admin/settings",
            read_json=lambda max_bytes=0: {
                "password": PASSWORD,
                "creator_fee_bps": 10,
                "rewards_distributor_address": "nope",
            },
            client_ip="10.0.0.5",
        )
        self.assertEqual(status, 400)
        self.assertEqual(json.loads(self._tmp.read_text(encoding="utf-8"))["creator_fee_bps"], 50)


class LaunchLookupTests(SettingsFileTestCase):
    """
    Reading the launch block off the factory instead of asking for it.

    A start block that is wrong by a little is the worst kind of wrong: it
    raises nothing, and simply pays nothing to everyone who bought earlier.
    So the lookup must refuse rather than fall back to a default.
    """

    FACTORY = "0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e"
    LAUNCH_BLOCK = 56_427_441
    CURVE = "0x489f769190E14c9E34424D4fb5D81513467b5266"
    DEPLOYER = "0x767bdF5E00F84B4868aB4342366C561FC049c0dB"

    class FactoryChain:
        def __init__(self, outer, *, found: bool = True) -> None:
            self.outer = outer
            self.found = found
            self.filters: list[dict] = []

        def post_json(self, url, payload, *, headers=None):
            from axiom_scanner.chain.pons_abi import TOKEN_LAUNCHED_TOPIC

            rid = payload["id"]
            if payload["method"] != "eth_getLogs":
                raise AssertionError(f"unexpected method {payload['method']}")
            f = payload["params"][0]
            self.filters.append(f)
            if not self.found:
                return {"jsonrpc": "2.0", "id": rid, "result": []}
            topic = lambda a: "0x" + a[2:].lower().rjust(64, "0")  # noqa: E731
            return {
                "jsonrpc": "2.0",
                "id": rid,
                "result": [
                    {
                        "blockNumber": hex(self.outer.LAUNCH_BLOCK),
                        "topics": [
                            "0x" + TOKEN_LAUNCHED_TOPIC.hex(),
                            topic(TOKEN),
                            topic(self.outer.CURVE),
                            topic(self.outer.DEPLOYER),
                        ],
                    }
                ],
            }

    def test_the_launch_block_is_read_from_the_factory(self) -> None:
        from axiom_scanner.rewards.launch_lookup import find_launch
        from axiom_scanner.chain.rpc_client import RpcClient

        chain = self.FactoryChain(self)
        result = find_launch(RpcClient("https://example.invalid", chain), TOKEN, self.FACTORY)
        self.assertEqual(result["block_number"], self.LAUNCH_BLOCK)
        self.assertEqual(result["curve"], self.CURVE)

    def test_the_filter_names_both_the_factory_and_the_token(self) -> None:
        """
        Without the token in the filter the node returns every launch ever
        made, and the first one back would be some stranger's token.
        """
        from axiom_scanner.rewards.launch_lookup import find_launch
        from axiom_scanner.chain.rpc_client import RpcClient

        chain = self.FactoryChain(self)
        find_launch(RpcClient("https://example.invalid", chain), TOKEN, self.FACTORY)
        f = chain.filters[0]
        self.assertEqual(f["address"].lower(), self.FACTORY.lower())
        self.assertEqual(len(f["topics"]), 2)
        self.assertIn(TOKEN[2:].lower(), f["topics"][1].lower())

    def test_a_token_not_launched_through_pons_is_refused(self) -> None:
        from axiom_scanner.rewards.launch_lookup import LaunchLookupError, find_launch
        from axiom_scanner.chain.rpc_client import RpcClient

        chain = self.FactoryChain(self, found=False)
        with self.assertRaises(LaunchLookupError) as ctx:
            find_launch(RpcClient("https://example.invalid", chain), TOKEN, self.FACTORY)
        self.assertEqual(ctx.exception.code, "LAUNCH_NOT_FOUND")

    def test_detect_needs_the_password(self) -> None:
        status, payload = handle_api_post(
            "/api/admin/settings",
            read_json=lambda max_bytes=0: {"password": "wrong", "detect": True, "token": TOKEN},
            client_ip="10.0.1.1",
        )
        self.assertEqual(status, 401)

    def test_detect_does_not_write_anything(self) -> None:
        """Looking up a block is a read; it must not touch stored settings."""
        self.write({"creator_fee_bps": 50})
        before = self._tmp.read_text(encoding="utf-8")
        handle_api_post(
            "/api/admin/settings",
            read_json=lambda max_bytes=0: {"password": PASSWORD, "detect": True, "token": TOKEN},
            client_ip="10.0.1.2",
        )
        self.assertEqual(self._tmp.read_text(encoding="utf-8"), before)


if __name__ == "__main__":
    unittest.main()
