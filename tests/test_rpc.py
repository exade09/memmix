from __future__ import annotations

import json
import os
import unittest
from unittest.mock import patch

from vercel_api.dispatch import handle_api_get, handle_api_post
from vercel_api.launch_config import DEFAULT_PONS_FACTORY, ROBINHOOD_MAINNET_ID
from vercel_api.routes.rpc import reset_rpc_limits


class HealthEndpointTests(unittest.TestCase):
    def test_health_reports_chain_and_no_secrets(self) -> None:
        os.environ["PINATA_JWT"] = "super-secret-pinata-jwt"
        os.environ["OPENAI_API_KEY"] = "sk-test-openai"
        os.environ["ENABLE_NATIVE_LAUNCH"] = "false"
        os.environ["ENABLE_MAINNET_LAUNCH"] = "false"
        with patch("vercel_api.routes.health._probe_rpc", return_value="ok"):
            status, payload = handle_api_get("/api/health", "")
        dumped = json.dumps(payload)
        self.assertEqual(status, 200)
        self.assertTrue(payload["success"])
        self.assertEqual(payload["data"]["chain"], "robinhood")
        # Readiness only: health names no launchpad.
        self.assertEqual(payload["data"]["launchpad"], "configured")
        self.assertNotIn("pons", json.dumps(payload).lower())
        self.assertEqual(payload["data"]["launchpad_address"], DEFAULT_PONS_FACTORY)
        self.assertEqual(payload["data"]["chain_id"], ROBINHOOD_MAINNET_ID)
        self.assertFalse(payload["data"]["native_launch"])
        self.assertFalse(payload["data"]["mainnet_launch"])
        self.assertNotIn("super-secret-pinata-jwt", dumped)
        self.assertNotIn("sk-test-openai", dumped)
        self.assertNotIn("PINATA_JWT", dumped)
        # Readiness is reported, the secret itself never is.
        self.assertIn(payload["data"]["image_jobs"], {"ready", "no_secret"})
        self.assertIn(payload["data"]["images"], {"ok", "unavailable"})


class RpcProxyTests(unittest.TestCase):
    def setUp(self) -> None:
        reset_rpc_limits()
        os.environ.pop("ALLOWED_ORIGINS", None)
        os.environ["ENABLE_NATIVE_LAUNCH"] = "false"
        os.environ["ENABLE_MAINNET_LAUNCH"] = "false"

    def _post(self, body, origin="http://localhost:5173"):
        return handle_api_post(
            "/api/chain/rpc",
            read_body=lambda max_bytes: body,
            client_ip="127.0.0.1",
            origin=origin,
            host="localhost:5173",
        )

    def test_blocks_unknown_methods(self) -> None:
        status, payload = self._post({"jsonrpc": "2.0", "id": 1, "method": "eth_getStorageAt", "params": []})
        self.assertEqual(status, 403)
        self.assertEqual(payload["error"]["code"], "RPC_METHOD_NOT_ALLOWED")

    def test_proxy_can_never_relay_a_signed_transaction(self) -> None:
        """
        Stronger than the Solana build, which gated sends behind a flag: the
        write method is simply not in the allowlist, so no flag can turn it on.
        Signing goes through the wallet and never touches this server.
        """
        os.environ["ENABLE_NATIVE_LAUNCH"] = "true"
        os.environ["ENABLE_MAINNET_LAUNCH"] = "true"
        reset_rpc_limits()
        status, payload = self._post(
            {"jsonrpc": "2.0", "id": 1, "method": "eth_sendRawTransaction", "params": ["0x01"]}
        )
        self.assertEqual(status, 403)
        self.assertEqual(payload["error"]["code"], "RPC_METHOD_NOT_ALLOWED")

    def test_allows_reads(self) -> None:
        calls = {"n": 0}

        def fake_forward(payload, *, timeout, retries):
            calls["n"] += 1
            calls["retries"] = retries
            return 200, {"jsonrpc": "2.0", "id": payload.get("id"), "result": {"ok": True}}

        with patch("vercel_api.routes.rpc.forward_rpc", side_effect=fake_forward):
            status, payload = self._post(
                {"jsonrpc": "2.0", "id": 7, "method": "eth_chainId", "params": []}
            )
        self.assertEqual(status, 200)
        self.assertEqual(payload["result"]["ok"], True)

        self.assertEqual(calls["n"], 1)

    def test_rejects_oversized_batch(self) -> None:
        batch = [{"jsonrpc": "2.0", "id": i, "method": "eth_getBalance", "params": []} for i in range(6)]
        status, payload = self._post(batch)
        self.assertEqual(status, 403)
        self.assertEqual(payload["error"]["code"], "INVALID_INPUT")

    def test_either_kill_switch_stops_a_launch(self) -> None:
        """
        The proxy no longer carries sends, so the kill switches are asserted
        where they now live: the launch gate itself. Both default to on now
        that the path runs through a deployed factory, so what matters is that
        either one still stops it.
        """
        from vercel_api.launch_config import send_transaction_allowed

        os.environ["ENABLE_NATIVE_LAUNCH"] = "true"
        os.environ["ENABLE_MAINNET_LAUNCH"] = "false"
        allowed, reason = send_transaction_allowed()
        self.assertFalse(allowed)
        self.assertIn("Mainnet", reason)

        os.environ["ENABLE_NATIVE_LAUNCH"] = "false"
        os.environ["ENABLE_MAINNET_LAUNCH"] = "true"
        allowed, reason = send_transaction_allowed()
        self.assertFalse(allowed)
        self.assertIn("disabled", reason)

    def test_launch_is_allowed_when_both_switches_are_on(self) -> None:
        from vercel_api.launch_config import send_transaction_allowed

        os.environ["ENABLE_NATIVE_LAUNCH"] = "true"
        os.environ["ENABLE_MAINNET_LAUNCH"] = "true"
        allowed, reason = send_transaction_allowed()
        self.assertTrue(allowed, reason)


class LaunchFlowRpcTests(unittest.TestCase):
    """
    eth_getBlockByNumber was missing from the allowlist, so viem's fee
    estimate got a 403 and every launch failed at the last step before the
    wallet opened. The proxy is the only path the client has, so a method it
    needs and does not have is a broken product, not a tightened one.
    """

    def setUp(self) -> None:
        reset_rpc_limits()
        os.environ.pop("ALLOWED_ORIGINS", None)

    def test_every_method_a_launch_needs_is_allowed(self) -> None:
        from vercel_api.launch_config import LAUNCH_FLOW_RPC_METHODS, RPC_ALLOWED_METHODS

        missing = LAUNCH_FLOW_RPC_METHODS - RPC_ALLOWED_METHODS
        self.assertEqual(missing, set(), f"launch would 403 on: {sorted(missing)}")

    def test_the_proxy_actually_accepts_them(self) -> None:
        from vercel_api.launch_config import LAUNCH_FLOW_RPC_METHODS

        def fake_forward(payload, *, timeout, retries):
            return 200, {"jsonrpc": "2.0", "id": payload.get("id"), "result": "0x1"}

        for method in sorted(LAUNCH_FLOW_RPC_METHODS):
            with self.subTest(method=method):
                reset_rpc_limits()
                with patch("vercel_api.routes.rpc.forward_rpc", side_effect=fake_forward):
                    status, _ = handle_api_post(
                        "/api/chain/rpc",
                        read_body=lambda max_bytes: {"jsonrpc": "2.0", "id": 1, "method": method, "params": []},
                        client_ip="127.0.0.1",
                        origin="http://localhost:5173",
                        host="localhost:5173",
                    )
                self.assertEqual(status, 200, f"{method} was rejected")

    def test_widening_the_list_did_not_let_a_write_in(self) -> None:
        from vercel_api.launch_config import RPC_ALLOWED_METHODS

        for method in RPC_ALLOWED_METHODS:
            self.assertFalse(
                method.startswith(("eth_send", "eth_sign", "personal_", "eth_account")),
                f"{method} can move funds or sign and must not be proxied",
            )


class PonsFactoryTests(unittest.TestCase):
    """
    The factory address is the one thing here that must never drift: it is
    where a user's launch fee goes. These values were read off the deployed
    contract, not copied from a blog post.
    """

    def test_defaults_to_the_verified_deployment(self) -> None:
        from vercel_api.launch_config import launchpad_address

        os.environ.pop("PONS_FACTORY_ADDRESS", None)
        self.assertEqual(launchpad_address(), DEFAULT_PONS_FACTORY)
        self.assertTrue(DEFAULT_PONS_FACTORY.startswith("0x"))
        self.assertEqual(len(DEFAULT_PONS_FACTORY), 42)

    def test_env_can_override_the_factory(self) -> None:
        from vercel_api.launch_config import launchpad_address

        os.environ["PONS_FACTORY_ADDRESS"] = "0x" + "2" * 40
        try:
            self.assertEqual(launchpad_address(), "0x" + "2" * 40)
        finally:
            os.environ.pop("PONS_FACTORY_ADDRESS", None)


if __name__ == "__main__":
    unittest.main()
