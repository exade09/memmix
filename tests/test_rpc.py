from __future__ import annotations

import json
import os
import unittest
from unittest.mock import patch

from vercel_api.dispatch import handle_api_get, handle_api_post
from vercel_api.launch_config import PINNED_LAUNCH_SDK_VERSION
from vercel_api.routes.rpc import reset_rpc_limits


class HealthEndpointTests(unittest.TestCase):
    def test_health_has_pinned_sdk_and_no_secrets(self) -> None:
        os.environ["PINATA_JWT"] = "super-secret-pinata-jwt"
        os.environ["OPENAI_API_KEY"] = "sk-test-openai"
        os.environ["ENABLE_NATIVE_LAUNCH"] = "false"
        os.environ["ENABLE_MAINNET_LAUNCH"] = "false"
        os.environ["SOLANA_CLUSTER"] = "devnet"
        with patch("vercel_api.routes.health._probe_rpc", return_value="ok"):
            status, payload = handle_api_get("/api/health", "")
        dumped = json.dumps(payload)
        self.assertEqual(status, 200)
        self.assertTrue(payload["success"])
        self.assertEqual(payload["data"]["launch_sdk_version"], PINNED_LAUNCH_SDK_VERSION)
        self.assertEqual(payload["data"]["cluster"], "devnet")
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
        os.environ["SOLANA_CLUSTER"] = "devnet"

    def _post(self, body, origin="http://localhost:5173"):
        return handle_api_post(
            "/api/solana/rpc",
            read_body=lambda max_bytes: body,
            client_ip="127.0.0.1",
            origin=origin,
            host="localhost:5173",
        )

    def test_blocks_unknown_methods(self) -> None:
        status, payload = self._post({"jsonrpc": "2.0", "id": 1, "method": "getProgramAccounts", "params": []})
        self.assertEqual(status, 403)
        self.assertEqual(payload["error"]["code"], "RPC_METHOD_NOT_ALLOWED")

    def test_blocks_send_when_native_launch_is_off(self) -> None:
        status, payload = self._post(
            {"jsonrpc": "2.0", "id": 1, "method": "sendTransaction", "params": ["AQID"]}
        )
        self.assertEqual(status, 403)
        self.assertEqual(payload["error"]["code"], "NATIVE_LAUNCH_DISABLED")

    def test_allows_read_and_does_not_retry_send(self) -> None:
        calls = {"n": 0}

        def fake_forward(payload, *, timeout, retries):
            calls["n"] += 1
            calls["retries"] = retries
            return 200, {"jsonrpc": "2.0", "id": payload.get("id"), "result": {"ok": True}}

        with patch("vercel_api.routes.rpc.forward_rpc", side_effect=fake_forward):
            status, payload = self._post(
                {"jsonrpc": "2.0", "id": 7, "method": "getLatestBlockhash", "params": []}
            )
        self.assertEqual(status, 200)
        self.assertEqual(payload["result"]["ok"], True)

        os.environ["ENABLE_NATIVE_LAUNCH"] = "true"
        reset_rpc_limits()
        with patch("vercel_api.routes.rpc.forward_rpc", side_effect=fake_forward):
            status, payload = self._post(
                {"jsonrpc": "2.0", "id": 8, "method": "sendTransaction", "params": ["AQID"]}
            )
        self.assertEqual(status, 200)
        self.assertEqual(calls["retries"], 0)

    def test_rejects_oversized_batch(self) -> None:
        batch = [{"jsonrpc": "2.0", "id": i, "method": "getBalance", "params": []} for i in range(6)]
        status, payload = self._post(batch)
        self.assertEqual(status, 403)
        self.assertEqual(payload["error"]["code"], "INVALID_INPUT")

    def test_mainnet_send_stays_off_without_owner_flag(self) -> None:
        os.environ["ENABLE_NATIVE_LAUNCH"] = "true"
        os.environ["SOLANA_CLUSTER"] = "mainnet-beta"
        os.environ["ENABLE_MAINNET_LAUNCH"] = "false"
        status, payload = self._post(
            {"jsonrpc": "2.0", "id": 1, "method": "sendTransaction", "params": ["AQID"]}
        )
        self.assertEqual(status, 403)
        self.assertIn("Mainnet", payload["error"]["message"])


if __name__ == "__main__":
    unittest.main()
