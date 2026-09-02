from __future__ import annotations

import json
import os
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from vercel_api.launch_config import (
    chain_id,
    chain_rpc_url,
    is_mainnet,
    launchpad_address,
    mainnet_launch_enabled,
    native_launch_enabled,
)


def health_payload(*, probe_rpc=None) -> dict[str, Any]:
    rpc_status = probe_rpc() if probe_rpc is not None else _probe_rpc()
    payload = {
        "status": "ok" if rpc_status == "ok" else "degraded",
        "scanner": "ok",
        "text_ai": "configured" if os.getenv("OPENAI_API_KEY", "").strip() else "disabled",
        "image_ai": (
            "configured"
            if os.getenv("WAVESPEED_API_KEY", "").strip() or os.getenv("WAVESPEED_API_KEYS", "").strip()
            else "disabled"
        ),
        "metadata": "configured" if os.getenv("PINATA_JWT", "").strip() else "disabled",
        "rpc": rpc_status,
        "chain": "robinhood",
        "chain_id": chain_id(),
        # Whether a launch can happen at all, without leaking the address itself.
        "launchpad": "configured" if launchpad_address() else "not_configured",
        "native_launch": native_launch_enabled(),
        "mainnet_launch": bool(mainnet_launch_enabled() and is_mainnet()),
    }
    dumped = json.dumps(payload)
    for name in ("PINATA_JWT", "OPENAI_API_KEY", "WAVESPEED_API_KEY"):
        secret = os.getenv(name, "").strip()
        if secret and secret in dumped:
            return {
                "status": "degraded",
                "scanner": "degraded",
                "text_ai": "disabled",
                "image_ai": "disabled",
                "metadata": "disabled",
                "rpc": "degraded",
                "chain": "robinhood",
                "chain_id": chain_id(),
                "launchpad": "not_configured",
                "native_launch": False,
                "mainnet_launch": False,
            }
    return payload


def _probe_rpc() -> str:
    """A chain id that matches what this build expects is the cheapest liveness proof."""
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "eth_chainId", "params": []}).encode("utf-8")
    request = Request(
        chain_rpc_url(),
        data=body,
        method="POST",
        headers={
            "Accept": "application/json",
            "Content-Type": "application/json",
            "User-Agent": "fons-health/0.1",
        },
    )
    try:
        with urlopen(request, timeout=8) as response:
            payload = json.loads(response.read().decode("utf-8"))
        result = payload.get("result") if isinstance(payload, dict) else None
        if isinstance(result, str) and result.startswith("0x"):
            return "ok"
        return "degraded"
    except (HTTPError, URLError, TimeoutError, json.JSONDecodeError, ValueError, OSError):
        return "degraded"
