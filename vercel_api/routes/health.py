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
        # Pillow is imported lazily deep inside avatar handling, so a missing
        # install only showed up as MISSING_PILLOW on a real upload, after the
        # user had filled in the whole form. Surfaced here instead.
        "images": _probe_pillow(),
        # A WaveSpeed key alone is not enough: avatar jobs are signed, and
        # without the secret they fail with a message that says nothing about
        # the cause. Reported separately so the missing half is obvious.
        "image_jobs": _probe_job_secret(),
        # Whether the CA admin can actually save. On Vercel that also needs a
        # GitHub token, since a production write goes through a commit rather
        # than the filesystem.
        "admin_ca": _probe_admin_ca(),
        "rpc": rpc_status,
        "chain": "robinhood",
        "chain_id": chain_id(),
        # Readiness only. The address stays because it is real diagnostics and
        # the wallet shows it at signing time anyway, but nothing here names
        # the launchpad.
        "launchpad": "configured" if launchpad_address() else "not_configured",
        "launchpad_address": launchpad_address(),
        "native_launch": native_launch_enabled(),
        "mainnet_launch": bool(mainnet_launch_enabled() and is_mainnet()),
    }
    dumped = json.dumps(payload)
    for name in ("PINATA_JWT", "OPENAI_API_KEY", "WAVESPEED_API_KEY", "ADMIN_CA_PASSWORD", "GITHUB_TOKEN"):
        secret = os.getenv(name, "").strip()
        if secret and secret in dumped:
            return {
                "status": "degraded",
                "scanner": "degraded",
                "text_ai": "disabled",
                "image_ai": "disabled",
                "metadata": "disabled",
                "images": _probe_pillow(),
                "image_jobs": "unavailable",
                "admin_ca": "unavailable",
                "rpc": "degraded",
                "chain": "robinhood",
                "chain_id": chain_id(),
                "launchpad": "not_configured",
                "native_launch": False,
                "mainnet_launch": False,
            }
    return payload


def _probe_admin_ca() -> str:
    """State only, never the password or the deploy token."""
    from vercel_api.routes.ca import _admin_password, _github_token, _is_local_dev

    if not _admin_password():
        return "no_password"
    if not _is_local_dev() and not _github_token():
        return "no_deploy_token"
    return "ready"


def _probe_job_secret() -> str:
    """
    Whether avatar jobs can be signed. Reports the state only, never the
    secret and never which of the accepted names supplied it.
    """
    from axiom_scanner.analysis.avatar_job import _hmac_secret

    return "ready" if _hmac_secret() else "no_secret"


def _probe_pillow() -> str:
    """Whether avatars can be processed at all on this deployment."""
    try:
        from PIL import Image  # noqa: F401
    except ImportError:
        return "unavailable"
    return "ok"


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
