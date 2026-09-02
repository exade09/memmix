from __future__ import annotations

import json
import os
import unittest
from unittest.mock import patch

from vercel_api.dispatch import handle_api_get, handle_api_post
from vercel_api.launch_config import ROBINHOOD_MAINNET_ID
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
        self.assertEqual(payload["data"]["launchpad"], "not_configured")
        self.assertEqual(payload["data"]["chain_id"], ROBINHOOD_MAINNET_ID)
        self.assertFalse(payload["data"]["native_launch"])
        self.assertFalse(payload["data"]["mainnet_launch"])
        self.assertNotIn("super-secret-pinata-jwt", dumped)
        self.assertNotIn("sk-test-openai", dumped)
        self.assertNotIn("PINATA_JWT", dumped)


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

    def test_mainnet_launch_stays_off_without_owner_flag(self) -> None:
        """
        The proxy no longer carries sends, so the mainnet kill switch is
        asserted where it now lives: the launch gate itself.
        """
        from vercel_api.launch_config import send_transaction_allowed

        os.environ["ENABLE_NATIVE_LAUNCH"] = "true"
        os.environ["FONS_LAUNCHPAD_ADDRESS"] = "0x" + "1" * 40
        os.environ["ROBINHOOD_MAINNET"] = "true"
        os.environ["ENABLE_MAINNET_LAUNCH"] = "false"
        allowed, reason = send_transaction_allowed()
        self.assertFalse(allowed)
        self.assertIn("Mainnet", reason)

        os.environ["ENABLE_NATIVE_LAUNCH"] = "false"
        allowed, reason = send_transaction_allowed()
        self.assertFalse(allowed)
        self.assertIn("disabled", reason)

        os.environ.pop("FONS_LAUNCHPAD_ADDRESS", None)
        os.environ.pop("ROBINHOOD_MAINNET", None)


if __name__ == "__main__":
    unittest.main()
