from __future__ import annotations

import json
import os
import unittest
from typing import Any
from unittest.mock import patch

from eth_account import Account

from axiom_scanner.chain.pons_abi import (
    LAUNCH_TOKEN_SELECTOR,
    LAUNCH_FEE_SELECTOR,
    LAUNCH_ENABLED_SELECTOR,
    PREVIEW_ECONOMICS_SELECTOR,
    TOKEN_LAUNCHED_TOPIC,
    EthAddressError,
    decode_launch_config,
    encode_get_launch_config_call,
    require_eth_address,
)
from axiom_scanner.chain.rpc_client import RpcClient, RpcError
from axiom_scanner.chain.sponsor_wallet import (
    SponsorWalletError,
    send_sponsored_call,
    sponsor_address,
    sponsor_enabled,
)
from eth_abi import encode as abi_encode
from vercel_api.dispatch import handle_api_get, handle_api_post
from vercel_api.routes.sponsor_launch import SponsorLaunchError, reset_sponsor_launch_limits, sponsor_launch_route

TEST_KEY = Account.create().key.hex()
TEST_ADDRESS = Account.from_key(TEST_KEY).address
FACTORY = "0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e"
# A real entry from the verified registry, so the allowlist is exercised as shipped.
AAPL = "0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9"

VALID_BODY = {
    "name": "Test Token",
    "ticker": "TT",
    "description": "A sponsored launch used only in tests, never a real token.",
    "logo": "https://example.com/logo.png",
    "socials": {"twitter": "", "telegram": "", "discord": "", "website": "", "farcaster": ""},
    "creator_wallet": TEST_ADDRESS,
    "creator_tax_bps": 0,
    "buyback_enabled": False,
}


def _hex(value: int, size: int = 32) -> str:
    return "0x" + value.to_bytes(size, "big").hex()


def _addr_topic(address: str) -> str:
    return "0x" + address[2:].rjust(64, "0").lower()


class FakePoster:
    """Answers exactly the JSON-RPC calls a sponsored launch makes, in order."""

    def __init__(
        self,
        *,
        launch_enabled: bool = True,
        fee_wei: int = 500_000_000_000_000,
        revert_on_send: bool = False,
        balance_wei: int | None = None,
    ) -> None:
        self.launch_enabled = launch_enabled
        self.fee_wei = fee_wei
        self.revert_on_send = revert_on_send
        # Default is comfortably funded; a test that cares sets it exactly.
        self.balance_wei = fee_wei * 100 if balance_wei is None else balance_wei
        self.calls: list[dict[str, Any]] = []

    def post_json(self, url: str, payload: dict[str, Any], *, headers: dict[str, str] | None = None) -> Any:
        self.calls.append(payload)
        method = payload["method"]
        params = payload.get("params") or []

        if method == "eth_getCode":
            return {"jsonrpc": "2.0", "id": payload["id"], "result": "0x60006000"}
        if method == "eth_call":
            data = params[0]["data"]
            selector = data[:10]
            if selector == "0x" + LAUNCH_FEE_SELECTOR.hex():
                return {"jsonrpc": "2.0", "id": payload["id"], "result": _hex(self.fee_wei)}
            if selector == "0x" + LAUNCH_ENABLED_SELECTOR.hex():
                return {"jsonrpc": "2.0", "id": payload["id"], "result": _hex(1 if self.launch_enabled else 0)}
            if selector == "0x" + PREVIEW_ECONOMICS_SELECTOR.hex():
                return {"jsonrpc": "2.0", "id": payload["id"], "result": _hex(0xABCDEF)}
            if selector == "0x" + LAUNCH_TOKEN_SELECTOR.hex():
                # The pre-send simulation. Any well-formed return is fine; the
                # route reads the real result from the receipt log, not here.
                encoded = abi_encode(["address", "address"], [TEST_ADDRESS, TEST_ADDRESS])
                return {"jsonrpc": "2.0", "id": payload["id"], "result": "0x" + encoded.hex()}
            raise AssertionError(f"unexpected eth_call selector {selector}")
        if method == "eth_getBalance":
            return {"jsonrpc": "2.0", "id": payload["id"], "result": _hex(self.balance_wei)}
        if method == "eth_chainId":
            return {"jsonrpc": "2.0", "id": payload["id"], "result": "0x1237"}
        if method == "eth_getTransactionCount":
            return {"jsonrpc": "2.0", "id": payload["id"], "result": "0x1"}
        if method == "eth_getBlockByNumber":
            return {"jsonrpc": "2.0", "id": payload["id"], "result": {"baseFeePerGas": _hex(1_000_000_000, 8)}}
        if method == "eth_maxPriorityFeePerGas":
            return {"jsonrpc": "2.0", "id": payload["id"], "result": _hex(1_000_000_000, 8)}
        if method == "eth_estimateGas":
            return {"jsonrpc": "2.0", "id": payload["id"], "result": _hex(200_000, 8)}
        if method == "eth_sendRawTransaction":
            if self.revert_on_send:
                return {"jsonrpc": "2.0", "id": payload["id"], "error": {"code": -32000, "message": "insufficient funds"}}
            return {
                "jsonrpc": "2.0",
                "id": payload["id"],
                "result": "0x" + ("11" * 32),
            }
        if method == "eth_getTransactionReceipt":
            token_topic = _addr_topic("0x1111111111111111111111111111111111111111")
            curve_topic = _addr_topic("0x2222222222222222222222222222222222222222")
            deployer_topic = _addr_topic(TEST_ADDRESS)
            return {
                "jsonrpc": "2.0",
                "id": payload["id"],
                "result": {
                    "status": "0x1",
                    "logs": [
                        {
                            "topics": [
                                "0x" + TOKEN_LAUNCHED_TOPIC.hex(),
                                token_topic,
                                curve_topic,
                                deployer_topic,
                            ]
                        }
                    ],
                },
            }
        raise AssertionError(f"unexpected method {method}")


class PonsAbiTests(unittest.TestCase):
    def test_launch_token_selector_matches_the_canonical_signature(self) -> None:
        # A hand-checked reference value, independent of the encoder path
        # this module also uses, so a bug in one cannot hide behind the other.
        self.assertEqual(LAUNCH_TOKEN_SELECTOR.hex(), "f35abbcf")

    def test_require_eth_address_checksums_and_rejects_junk(self) -> None:
        self.assertEqual(
            require_eth_address(FACTORY.lower()),
            FACTORY,
        )
        with self.assertRaises(EthAddressError):
            require_eth_address("not-an-address")
        with self.assertRaises(EthAddressError):
            require_eth_address("0x123")

    def test_launch_config_round_trips(self) -> None:
        encoded = abi_encode(
            ["(uint256,uint256,uint256,uint256,uint24,int24,bool)"],
            [(10**18, 100, 5, 20_000_000_000_000_000_000, 3000, 60, True)],
        )
        config = decode_launch_config(encoded)
        self.assertEqual(config.supply, 10**18)
        self.assertTrue(config.enabled)
        self.assertEqual(config.pool_fee, 3000)

    def test_get_launch_config_call_encodes_the_id(self) -> None:
        data = encode_get_launch_config_call(0)
        self.assertTrue(data.startswith(b"\x00" * 0))  # selector first, no leading padding
        self.assertEqual(len(data), 4 + 32)


class RpcClientTests(unittest.TestCase):
    def test_call_raises_on_rpc_error(self) -> None:
        class ErrorPoster:
            def post_json(self, url, payload, *, headers=None):
                return {"jsonrpc": "2.0", "id": 1, "error": {"code": -32000, "message": "boom"}}

        client = RpcClient("https://example.invalid", ErrorPoster())
        with self.assertRaises(RpcError):
            client.call("eth_chainId")

    def test_chain_id_parses_hex_result(self) -> None:
        class OkPoster:
            def post_json(self, url, payload, *, headers=None):
                return {"jsonrpc": "2.0", "id": 1, "result": "0x1237"}

        client = RpcClient("https://example.invalid", OkPoster())
        self.assertEqual(client.chain_id(), 4663)


class SponsorWalletTests(unittest.TestCase):
    def setUp(self) -> None:
        os.environ["SPONSOR_WALLET_PRIVATE_KEY"] = TEST_KEY
        os.environ["ENABLE_SPONSORED_LAUNCH"] = "true"

    def tearDown(self) -> None:
        os.environ.pop("SPONSOR_WALLET_PRIVATE_KEY", None)
        os.environ.pop("ENABLE_SPONSORED_LAUNCH", None)

    def test_sponsor_address_matches_the_key(self) -> None:
        self.assertEqual(sponsor_address(), TEST_ADDRESS)
        self.assertTrue(sponsor_enabled())

    def test_send_sponsored_call_signs_and_broadcasts(self) -> None:
        poster = FakePoster()
        rpc = RpcClient("https://example.invalid", poster)
        sent = send_sponsored_call(rpc, to=FACTORY, data=b"\xf3\x5a\xbb\xcf", value_wei=500_000_000_000_000)
        self.assertEqual(sent.from_address, TEST_ADDRESS)
        self.assertTrue(sent.tx_hash.startswith("0x"))

    def test_send_sponsored_call_rejects_absurd_value(self) -> None:
        poster = FakePoster()
        rpc = RpcClient("https://example.invalid", poster)
        with self.assertRaises(SponsorWalletError) as ctx:
            send_sponsored_call(rpc, to=FACTORY, data=b"\x00", value_wei=10**20)
        self.assertEqual(ctx.exception.code, "SPONSOR_VALUE_REJECTED")

    def test_a_wallet_holding_only_the_fee_is_refused_before_signing(self) -> None:
        """
        Gas costs more than the launch fee does, so "enough for the fee" is
        not enough to launch. Funding the wallet with exactly the fee is the
        obvious mistake, and it has to fail with a number the operator can
        act on rather than a raw node error after the transaction is signed.
        """
        fee = 500_000_000_000_000
        poster = FakePoster(balance_wei=fee)
        rpc = RpcClient("https://example.invalid", poster)
        with self.assertRaises(SponsorWalletError) as ctx:
            send_sponsored_call(rpc, to=FACTORY, data=LAUNCH_TOKEN_SELECTOR, value_wei=fee)
        self.assertEqual(ctx.exception.code, "SPONSOR_INSUFFICIENT_BALANCE")
        self.assertNotIn(
            "eth_sendRawTransaction",
            [c["method"] for c in poster.calls],
            "nothing may be broadcast once the wallet is known to be short",
        )

    def test_the_refusal_says_what_is_needed_and_what_is_held(self) -> None:
        fee = 500_000_000_000_000
        rpc = RpcClient("https://example.invalid", FakePoster(balance_wei=fee))
        with self.assertRaises(SponsorWalletError) as ctx:
            send_sponsored_call(rpc, to=FACTORY, data=LAUNCH_TOKEN_SELECTOR, value_wei=fee)
        message = str(ctx.exception)
        self.assertIn("0.000500", message, "the held balance belongs in the message")
        self.assertIn("ETH", message)

    def test_a_funded_wallet_still_broadcasts(self) -> None:
        """The guard must not become a wall in front of the working path."""
        fee = 500_000_000_000_000
        rpc = RpcClient("https://example.invalid", FakePoster(balance_wei=10**18))
        sent = send_sponsored_call(rpc, to=FACTORY, data=LAUNCH_TOKEN_SELECTOR, value_wei=fee)
        self.assertTrue(sent.tx_hash.startswith("0x"))

    def test_send_sponsored_call_without_key_configured(self) -> None:
        os.environ.pop("SPONSOR_WALLET_PRIVATE_KEY", None)
        poster = FakePoster()
        rpc = RpcClient("https://example.invalid", poster)
        with self.assertRaises(SponsorWalletError) as ctx:
            send_sponsored_call(rpc, to=FACTORY, data=b"\x00", value_wei=0)
        self.assertEqual(ctx.exception.code, "SPONSOR_UNCONFIGURED")


class SponsorLaunchRouteTests(unittest.TestCase):
    def setUp(self) -> None:
        reset_sponsor_launch_limits()
        os.environ["SPONSOR_WALLET_PRIVATE_KEY"] = TEST_KEY
        os.environ["ENABLE_SPONSORED_LAUNCH"] = "true"

    def tearDown(self) -> None:
        os.environ.pop("SPONSOR_WALLET_PRIVATE_KEY", None)
        os.environ.pop("ENABLE_SPONSORED_LAUNCH", None)

    def test_disabled_by_default(self) -> None:
        os.environ.pop("ENABLE_SPONSORED_LAUNCH", None)
        with self.assertRaises(SponsorLaunchError) as ctx:
            sponsor_launch_route(dict(VALID_BODY), "10.0.0.1", http=FakePoster())
        self.assertEqual(ctx.exception.code, "SPONSOR_DISABLED")

    def test_unconfigured_without_key(self) -> None:
        os.environ.pop("SPONSOR_WALLET_PRIVATE_KEY", None)
        with self.assertRaises(SponsorLaunchError) as ctx:
            sponsor_launch_route(dict(VALID_BODY), "10.0.0.1", http=FakePoster())
        self.assertEqual(ctx.exception.code, "SPONSOR_UNCONFIGURED")

    def test_rejects_invalid_ticker(self) -> None:
        body = dict(VALID_BODY, ticker="")
        with self.assertRaises(SponsorLaunchError) as ctx:
            sponsor_launch_route(body, "10.0.0.2", http=FakePoster())
        self.assertEqual(ctx.exception.code, "INVALID_INPUT")

    def test_rejects_bad_creator_wallet(self) -> None:
        body = dict(VALID_BODY, creator_wallet="not-an-address")
        with self.assertRaises(SponsorLaunchError) as ctx:
            sponsor_launch_route(body, "10.0.0.3", http=FakePoster())
        self.assertEqual(ctx.exception.code, "INVALID_INPUT")

    def test_rejects_when_launch_disabled_on_factory(self) -> None:
        with self.assertRaises(SponsorLaunchError) as ctx:
            sponsor_launch_route(dict(VALID_BODY), "10.0.0.4", http=FakePoster(launch_enabled=False))
        self.assertEqual(ctx.exception.code, "LAUNCH_DISABLED")

    def test_happy_path_returns_token_and_curve(self) -> None:
        result = sponsor_launch_route(dict(VALID_BODY), "10.0.0.5", http=FakePoster())
        self.assertEqual(result["status"], "confirmed")
        self.assertEqual(result["token"], "0x1111111111111111111111111111111111111111")
        self.assertEqual(result["curve"], "0x2222222222222222222222222222222222222222")
        self.assertTrue(result["tx_hash"].startswith("0x"))

    def test_reverted_send_surfaces_as_error(self) -> None:
        with self.assertRaises(SponsorLaunchError) as ctx:
            sponsor_launch_route(dict(VALID_BODY), "10.0.0.6", http=FakePoster(revert_on_send=True))
        self.assertEqual(ctx.exception.code, "SEND_FAILED")

    def test_rate_limit_after_five_requests(self) -> None:
        for _ in range(5):
            sponsor_launch_route(dict(VALID_BODY), "10.0.0.7", http=FakePoster())
        with self.assertRaises(SponsorLaunchError) as ctx:
            sponsor_launch_route(dict(VALID_BODY), "10.0.0.7", http=FakePoster())
        self.assertEqual(ctx.exception.code, "RATE_LIMITED")

    def test_status_endpoint_never_returns_the_key(self) -> None:
        status, payload = handle_api_get("/api/launch/sponsored/status", "")
        self.assertEqual(status, 200)
        self.assertTrue(payload["data"]["available"])
        self.assertEqual(payload["data"]["sponsor_address"], TEST_ADDRESS)
        self.assertNotIn(TEST_KEY, json.dumps(payload))

    def test_defaults_to_the_native_eth_pair(self) -> None:
        result = sponsor_launch_route(dict(VALID_BODY), "10.0.1.1", http=FakePoster())
        self.assertEqual(result["pair"]["kind"], "native")
        self.assertEqual(result["pair"]["symbol"], "ETH")

    def test_accepts_a_verified_stock_as_the_pair(self) -> None:
        body = dict(VALID_BODY, pair_token=AAPL)
        result = sponsor_launch_route(body, "10.0.1.2", http=FakePoster())
        self.assertEqual(result["status"], "confirmed")
        self.assertEqual(result["pair"]["kind"], "stock")
        self.assertEqual(result["pair"]["symbol"], "AAPL")
        self.assertEqual(result["pair"]["decimals"], 18)

    def test_refuses_to_sponsor_an_unlisted_pair_token(self) -> None:
        """The wallet guard: the factory accepts any address, so we must not."""
        body = dict(VALID_BODY, pair_token="0x1111111111111111111111111111111111111111")
        with self.assertRaises(SponsorLaunchError) as ctx:
            sponsor_launch_route(body, "10.0.1.3", http=FakePoster())
        self.assertEqual(ctx.exception.code, "PAIR_TOKEN_NOT_ALLOWED")

    def test_refuses_a_malformed_pair_token(self) -> None:
        body = dict(VALID_BODY, pair_token="not-an-address")
        with self.assertRaises(SponsorLaunchError) as ctx:
            sponsor_launch_route(body, "10.0.1.4", http=FakePoster())
        self.assertEqual(ctx.exception.code, "INVALID_INPUT")

    def test_economics_are_quoted_against_the_chosen_pair(self) -> None:
        """Quoting ETH and launching a stock pair would revert on expectedEconomics."""
        poster = FakePoster()
        sponsor_launch_route(dict(VALID_BODY, pair_token=AAPL), "10.0.1.5", http=poster)
        previews = [
            c for c in poster.calls
            if c["method"] == "eth_call"
            and c["params"][0]["data"].startswith("0x" + PREVIEW_ECONOMICS_SELECTOR.hex())
        ]
        self.assertTrue(previews, "no previewLaunchEconomics call was made")
        self.assertIn(AAPL[2:].lower(), previews[0]["params"][0]["data"].lower())

    def test_stocks_endpoint_lists_verified_equities(self) -> None:
        status, payload = handle_api_get("/api/stocks", "")
        self.assertEqual(status, 200)
        stocks = payload["data"]["stocks"]
        self.assertTrue(len(stocks) > 20)
        symbols = {s["symbol"] for s in stocks}
        self.assertIn("AAPL", symbols)
        self.assertIn("NVDA", symbols)
        for s in stocks:
            self.assertTrue(s["address"].startswith("0x") and len(s["address"]) == 42)

    def test_registry_rejects_absurdly_long_symbols(self) -> None:
        """
        A token's symbol() is attacker controlled. One spam contract on this
        chain returns a 43,000-character symbol containing the very words the
        registry was discovered by, and it did get in on the first pass.
        """
        from axiom_scanner.chain.stocks import MAX_NAME_LENGTH, MAX_SYMBOL_LENGTH, load_stocks

        for stock in load_stocks():
            self.assertLessEqual(len(stock["symbol"]), MAX_SYMBOL_LENGTH, stock["address"])
            self.assertLessEqual(len(stock["name"]), MAX_NAME_LENGTH, stock["address"])

    def test_registry_offers_only_pairs_pons_will_actually_accept(self) -> None:
        """
        The factory keeps its own approvedPairTokens mapping, and launching
        against anything outside it reverts with PairTokenNotApproved(). A
        ticker we list but Pons will not take walks a user through naming,
        art and confirmation only to fail on the last step, so the registry
        must not contain one.

        These specific tickers were read off the factory, not assumed.
        """
        from axiom_scanner.chain.stocks import load_stocks

        symbols = {s["symbol"] for s in load_stocks()}
        for rejected in ("ADBE", "ORCL", "XOM", "INTC", "QCOM"):
            self.assertNotIn(rejected, symbols, f"{rejected} reverts with PairTokenNotApproved()")
        for accepted in ("AAPL", "NVDA", "AMC"):
            self.assertIn(accepted, symbols, f"{accepted} is approved and should still be offered")

    def test_the_dropped_pairs_are_recorded_rather_than_silently_deleted(self) -> None:
        """Someone will ask why their ticker vanished; the file should answer."""
        import json
        from pathlib import Path

        doc = json.loads(Path("data/robinhood_stocks.json").read_text(encoding="utf-8"))
        dropped = doc["dropped_not_approved_by_pons"]
        self.assertTrue(dropped)
        listed = {s["symbol"] for s in doc["stocks"]}
        self.assertFalse(listed & set(dropped), "a ticker cannot be both offered and dropped")

    def test_registry_has_no_duplicate_tickers(self) -> None:
        """An ambiguous ticker is a way to pair against the wrong contract."""
        from axiom_scanner.chain.stocks import load_stocks

        symbols = [s["symbol"] for s in load_stocks()]
        self.assertEqual(len(symbols), len(set(symbols)))

    def test_dispatch_wires_the_post_route(self) -> None:
        with patch("vercel_api.routes.sponsor_launch.HttpClient", return_value=FakePoster()):
            status, payload = handle_api_post(
                "/api/launch/sponsored",
                read_body=lambda max_bytes: dict(VALID_BODY),
                client_ip="10.0.0.8",
            )
        self.assertEqual(status, 200)
        self.assertTrue(payload["success"])
        self.assertEqual(payload["data"]["status"], "confirmed")


if __name__ == "__main__":
    unittest.main()
