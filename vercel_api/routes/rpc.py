from __future__ import annotations

import json
import time
from collections import defaultdict
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen

from vercel_api.envelope import envelope
from vercel_api.launch_config import (
    RPC_ALLOWED_METHODS,
    RPC_MAX_BATCH,
    RPC_MAX_BODY_BYTES,
    RPC_READ_LIMIT,
    RPC_READ_WINDOW_SECONDS,
    RPC_SEND_LIMIT,
    RPC_SEND_WINDOW_SECONDS,
    allowed_origins,
    send_transaction_allowed,
    solana_rpc_url,
)


_READ_HITS: dict[str, list[float]] = defaultdict(list)
_SEND_HITS: dict[str, list[float]] = defaultdict(list)


def reset_rpc_limits() -> None:
    _READ_HITS.clear()
    _SEND_HITS.clear()


class RpcProxyError(RuntimeError):
    def __init__(self, message: str, code: str, status: int = 403) -> None:
        super().__init__(message)
        self.code = code
        self.status = status


def solana_rpc_route(
    payload: Any,
    *,
    client_ip: str,
    origin: str,
    host: str = "",
    now: float | None = None,
    forward=None,
) -> tuple[int, dict[str, Any]]:
    try:
        _check_origin(origin, host)
        methods = _rpc_methods(payload)
        if any(method == "sendTransaction" for method in methods):
            allowed, reason = send_transaction_allowed()
            if not allowed:
                raise RpcProxyError(reason, "NATIVE_LAUNCH_DISABLED", 403)
            if not isinstance(payload, dict) or payload.get("method") != "sendTransaction":
                raise RpcProxyError("sendTransaction must be a single JSON-RPC request.", "INVALID_INPUT", 403)
            _check_send_params(payload)
            retry_after = _hit(_SEND_HITS, client_ip, RPC_SEND_WINDOW_SECONDS, RPC_SEND_LIMIT, now)
            if retry_after is not None:
                raise RpcProxyError(
                    f"The lab needs a short cooldown. Try again in {retry_after} seconds.",
                    "RATE_LIMITED",
                    429,
                )
            status, body = (forward or forward_rpc)(payload, timeout=30.0, retries=0)
            return status, body
        retry_after = _hit(_READ_HITS, client_ip, RPC_READ_WINDOW_SECONDS, RPC_READ_LIMIT, now)
        if retry_after is not None:
            raise RpcProxyError(
                f"The lab needs a short cooldown. Try again in {retry_after} seconds.",
                "RATE_LIMITED",
                429,
            )
        timeout = 20.0 if "simulateTransaction" in methods else 12.0
        status, body = (forward or forward_rpc)(payload, timeout=timeout, retries=2)
        return status, body
    except RpcProxyError as exc:
        return exc.status, envelope(success=False, code=exc.code, message=str(exc))


def forward_rpc(payload: Any, *, timeout: float, retries: int) -> tuple[int, dict[str, Any]]:
    url = solana_rpc_url()
    data = json.dumps(payload).encode("utf-8")
    last_error: Exception | None = None
    attempts = max(retries, 0) + 1
    for attempt in range(attempts):
        request = Request(
            url,
            data=data,
            method="POST",
            headers={
                "Accept": "application/json",
                "Content-Type": "application/json",
                "User-Agent": "mixborn-rpc-proxy/0.1",
            },
        )
        try:
            with urlopen(request, timeout=timeout) as response:
                raw = response.read().decode("utf-8")
            parsed = json.loads(raw)
            if not isinstance(parsed, (dict, list)):
                raise RpcProxyError("RPC returned an unusable payload.", "RPC_UNAVAILABLE", 502)
            return 200, parsed
        except json.JSONDecodeError as exc:
            last_error = exc
            break
        except HTTPError as exc:
            last_error = exc
            if exc.code == 429:
                return 429, envelope(
                    success=False,
                    code="RATE_LIMITED",
                    message="The RPC is rate limited. Retry in a moment.",
                )
            if attempt < retries:
                time.sleep(0.4 * (attempt + 1))
                continue
        except (URLError, TimeoutError, OSError) as exc:
            last_error = exc
            if attempt < retries:
                time.sleep(0.4 * (attempt + 1))
                continue
    del last_error
    return 504, envelope(success=False, code="RPC_UNAVAILABLE", message="The Solana RPC is unavailable.")


def encoded_rpc_size(payload: Any) -> int:
    return len(json.dumps(payload).encode("utf-8"))


def _rpc_methods(payload: Any) -> list[str]:
    if isinstance(payload, dict):
        method = payload.get("method")
        if not isinstance(method, str) or method not in RPC_ALLOWED_METHODS:
            raise RpcProxyError("That RPC method is not allowed.", "RPC_METHOD_NOT_ALLOWED", 403)
        return [method]
    if isinstance(payload, list):
        if len(payload) == 0 or len(payload) > RPC_MAX_BATCH:
            raise RpcProxyError("RPC batch is limited to 5 calls.", "INVALID_INPUT", 403)
        methods: list[str] = []
        for item in payload:
            if not isinstance(item, dict):
                raise RpcProxyError("RPC batch items must be JSON-RPC objects.", "INVALID_INPUT", 400)
            method = item.get("method")
            if not isinstance(method, str) or method not in RPC_ALLOWED_METHODS:
                raise RpcProxyError("That RPC method is not allowed.", "RPC_METHOD_NOT_ALLOWED", 403)
            methods.append(method)
        return methods
    raise RpcProxyError("Request body must be JSON-RPC.", "INVALID_INPUT", 400)


def _check_send_params(payload: dict[str, Any]) -> None:
    params = payload.get("params")
    if not isinstance(params, list) or not params:
        raise RpcProxyError("sendTransaction requires a signed transaction.", "INVALID_INPUT", 400)
    raw = params[0]
    if not isinstance(raw, str) or not raw.strip():
        raise RpcProxyError("sendTransaction accepts only a base64 signed transaction.", "INVALID_INPUT", 400)
    # Server never signs. Reject obvious secret-bearing fields if a client sends a dict.
    if isinstance(params[0], dict):
        raise RpcProxyError("sendTransaction accepts only a base64 signed transaction.", "INVALID_INPUT", 400)


def _check_origin(origin: str, host: str) -> None:
    allowed = allowed_origins()
    origin = (origin or "").strip().rstrip("/")
    if allowed:
        if origin not in allowed:
            raise RpcProxyError("Origin is not allowed.", "INVALID_INPUT", 403)
        return
    if not origin:
        return
    parsed = urlparse(origin)
    hostname = (parsed.hostname or "").lower()
    if hostname in {"localhost", "127.0.0.1"}:
        return
    host_name = (urlparse(f"https://{host}").hostname if host and "://" not in host else urlparse(host).hostname) or host
    if host_name and hostname == host_name.split(":", 1)[0].lower():
        return
    raise RpcProxyError("Origin is not allowed.", "INVALID_INPUT", 403)


def _hit(store: dict[str, list[float]], client_ip: str, window: int, limit: int, now: float | None) -> int | None:
    stamp = now if now is not None else time.time()
    ip = client_ip or "unknown"
    hits = [item for item in store[ip] if stamp - item < window]
    if len(hits) >= limit:
        oldest = min(hits)
        return max(1, int(window - (stamp - oldest)))
    hits.append(stamp)
    store[ip] = hits
    return None


def reject_oversized(content_length: int) -> tuple[int, dict] | None:
    if content_length > RPC_MAX_BODY_BYTES:
        return 413, envelope(success=False, code="INVALID_INPUT", message="RPC body is too large.")
    return None
