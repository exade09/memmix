from __future__ import annotations

"""
A minimal JSON-RPC client for talking to the Robinhood Chain node directly,
server to server. This is deliberately separate from vercel_api/routes/rpc.py:
that proxy is the browser's read-only window onto the chain (no method that
can send or sign a transaction is on its allowlist, on purpose). Sponsoring a
launch happens entirely on the server, so it talks to the RPC endpoint
directly and never touches that proxy or its allowlist.
"""

import itertools
from typing import Any, Protocol


class JsonPoster(Protocol):
    def post_json(self, url: str, payload: dict[str, Any], *, headers: dict[str, str] | None = None) -> Any: ...


class RpcError(RuntimeError):
    def __init__(self, message: str, *, code: int | None = None) -> None:
        super().__init__(message)
        self.rpc_code = code


class RpcClient:
    def __init__(self, url: str, http: JsonPoster) -> None:
        self._url = url
        self._http = http
        self._ids = itertools.count(1)

    def call(self, method: str, params: list[Any] | None = None) -> Any:
        payload = {"jsonrpc": "2.0", "id": next(self._ids), "method": method, "params": params or []}
        response = self._http.post_json(self._url, payload)
        if not isinstance(response, dict):
            raise RpcError(f"{method}: malformed RPC response")
        error = response.get("error")
        if error:
            message = error.get("message") if isinstance(error, dict) else str(error)
            code = error.get("code") if isinstance(error, dict) else None
            raise RpcError(f"{method}: {message}", code=code)
        if "result" not in response:
            raise RpcError(f"{method}: RPC response has no result")
        return response["result"]

    def chain_id(self) -> int:
        return int(self.call("eth_chainId"), 16)

    def get_balance(self, address: str) -> int:
        return int(self.call("eth_getBalance", [address, "latest"]), 16)

    def get_code(self, address: str) -> str:
        return str(self.call("eth_getCode", [address, "latest"]))

    def get_transaction_count(self, address: str) -> int:
        return int(self.call("eth_getTransactionCount", [address, "pending"]), 16)

    def max_priority_fee_per_gas(self) -> int:
        return int(self.call("eth_maxPriorityFeePerGas"), 16)

    def base_fee_per_gas(self) -> int:
        block = self.call("eth_getBlockByNumber", ["latest", False])
        raw = (block or {}).get("baseFeePerGas")
        if raw is None:
            raise RpcError("Latest block has no baseFeePerGas; this chain may not support EIP-1559.")
        return int(raw, 16)

    def estimate_gas(self, tx: dict[str, Any]) -> int:
        return int(self.call("eth_estimateGas", [tx]), 16)

    def eth_call(self, tx: dict[str, Any]) -> bytes:
        raw = self.call("eth_call", [tx, "latest"])
        return bytes.fromhex(str(raw)[2:])

    def send_raw_transaction(self, raw_tx: bytes) -> str:
        return str(self.call("eth_sendRawTransaction", ["0x" + raw_tx.hex()]))

    def get_transaction_receipt(self, tx_hash: str) -> dict[str, Any] | None:
        return self.call("eth_getTransactionReceipt", [tx_hash])
