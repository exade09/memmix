from __future__ import annotations

import os
import time
from collections import defaultdict
from typing import Any

from axiom_scanner.analysis.avatar_job import (
    MixError,
    avatar_job_status,
    start_avatar_job,
)
from axiom_scanner.analysis.wavespeed_hybrid import HybridImage


_HITS: dict[str, list[float]] = defaultdict(list)
_LAST: dict[str, float] = {}


def reset_avatar_limits() -> None:
    _HITS.clear()
    _LAST.clear()


def avatar_start_route(
    fields: dict[str, str],
    files: dict[str, HybridImage],
    client_ip: str,
    *,
    provider=None,
    now: float | None = None,
) -> dict[str, Any]:
    retry_after = _rate_limit(client_ip, now=now)
    if retry_after is not None:
        raise MixError(
            f"The lab needs a short cooldown. Try again in {retry_after} seconds.",
            "RATE_LIMITED",
        )
    return start_avatar_job(
        fields=fields,
        files=files,
        client_ip=client_ip,
        provider=provider,
        now=now,
    )


def avatar_status_route(
    token: str,
    *,
    provider=None,
    now: float | None = None,
) -> dict[str, Any]:
    if not (token or "").strip():
        raise MixError("That avatar job is not valid.", "INVALID_JOB")
    return avatar_job_status(token.strip(), provider=provider, now=now)


def _rate_limit(client_ip: str, *, now: float | None = None) -> int | None:
    stamp = now if now is not None else time.time()
    window = _env_int("AVATAR_RATE_WINDOW_SECONDS", 600)
    max_hits = _env_int("AVATAR_RATE_LIMIT", 6)
    cooldown = _env_int("AVATAR_COOLDOWN_SECONDS", 8)
    ip = client_ip or "unknown"
    last = _LAST.get(ip, 0.0)
    if stamp - last < cooldown:
        return max(1, int(cooldown - (stamp - last)))
    hits = [item for item in _HITS[ip] if stamp - item < window]
    if len(hits) >= max_hits:
        oldest = min(hits)
        return max(1, int(window - (stamp - oldest)))
    hits.append(stamp)
    _HITS[ip] = hits
    _LAST[ip] = stamp
    return None


def _env_int(name: str, default: int) -> int:
    try:
        return max(1, int(os.getenv(name, str(default))))
    except ValueError:
        return default
