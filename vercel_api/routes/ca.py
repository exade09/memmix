from __future__ import annotations

import hmac
import json
import os
import time
from collections import defaultdict
from typing import Any

from vercel_api.github_store import StoreError, save_json
from vercel_api.shared import PROJECT_ROOT

CA_FILE = PROJECT_ROOT / "data" / "ca.json"
# Generous on purpose: "TBA", a full address, a short note before launch, a
# link — whatever the header needs to say at the time. The cap exists only to
# stop a pathological paste from bloating the stored file, not to police
# format or intent.
CA_MAX_LENGTH = 256

RATE_LIMIT = 8
RATE_WINDOW_SECONDS = 600


class CaError(RuntimeError):
    def __init__(self, message: str, code: str) -> None:
        super().__init__(message)
        self.code = code


_HITS: dict[str, list[float]] = defaultdict(list)


def reset_ca_rate_limit() -> None:
    _HITS.clear()


def read_ca() -> dict[str, Any]:
    """
    The header's public read. Always the bundled file, never GitHub: a page
    view must not depend on a third-party API being up, and the deployed
    bundle is only ever as stale as the last deploy the write itself
    triggered.
    """
    try:
        raw = json.loads(CA_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {"ca": "", "updated_at": None}
    if not isinstance(raw, dict):
        return {"ca": "", "updated_at": None}
    return {
        "ca": str(raw.get("ca") or "").strip(),
        "updated_at": raw.get("updated_at"),
    }


def _admin_password() -> str:
    return (os.getenv("ADMIN_CA_PASSWORD") or "").strip()


def _rate_limited(client_ip: str, *, now: float) -> bool:
    ip = client_ip or "unknown"
    hits = [t for t in _HITS[ip] if now - t < RATE_WINDOW_SECONDS]
    hits.append(now)
    _HITS[ip] = hits
    return len(hits) > RATE_LIMIT


def update_ca(
    *,
    password: str,
    ca: str,
    client_ip: str,
    now: float | None = None,
) -> dict[str, Any]:
    stamp = now if now is not None else time.time()

    if _rate_limited(client_ip, now=stamp):
        raise CaError("Too many attempts. Try again later.", "RATE_LIMITED")

    expected = _admin_password()
    if not expected:
        raise CaError("Admin editing is not configured.", "ADMIN_DISABLED")
    supplied = (password or "").strip()
    # Constant-time: a password check is exactly the kind of comparison a
    # timing difference can leak, one character at a time.
    if not supplied or not hmac.compare_digest(supplied, expected):
        raise CaError("Wrong password.", "WRONG_PASSWORD")

    clean = " ".join((ca or "").split()).strip()
    if len(clean) > CA_MAX_LENGTH:
        raise CaError(f"Keep it under {CA_MAX_LENGTH} characters.", "TOO_LONG")

    updated_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(stamp))
    payload = {"ca": clean, "updated_at": updated_at}

    try:
        live_in = save_json(
            path=CA_FILE,
            rel_path="data/ca.json",
            payload=payload,
            message="Update contract address",
        )
    except StoreError as exc:
        raise CaError(str(exc), exc.code) from exc
    return {"ca": clean, "updated_at": updated_at, "live_in_seconds": live_in}
