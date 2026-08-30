from __future__ import annotations

import os
import time
from collections import defaultdict
from typing import Any

from axiom_scanner.analysis.wavespeed_hybrid import HybridImage
from axiom_scanner.security.fields import require_confirmed
from axiom_scanner.security.images import ImageError
from axiom_scanner.storage.metadata import pin_launch_metadata
from axiom_scanner.storage.pinata import MetadataError, Pinner


_HITS: dict[str, list[float]] = defaultdict(list)
_LAST: dict[str, float] = {}


def reset_pin_limits() -> None:
    _HITS.clear()
    _LAST.clear()


def metadata_pin_route(
    fields: dict[str, str],
    files: dict[str, HybridImage],
    client_ip: str,
    *,
    pinner: Pinner | None = None,
    now: float | None = None,
) -> dict[str, Any]:
    retry_after = _rate_limit(client_ip, now=now)
    if retry_after is not None:
        raise MetadataError(
            f"The lab needs a short cooldown. Try again in {retry_after} seconds.",
            "RATE_LIMITED",
        )
    require_confirmed(fields.get("rights_confirmed"), label="Rights")
    require_confirmed(fields.get("risk_confirmed"), label="Risk")
    avatar = files.get("avatar")
    if avatar is None or not avatar.data:
        raise ImageError("Avatar is required.", "MISSING_IMAGE")
    return pin_launch_metadata(image_bytes=avatar.data, fields=fields, pinner=pinner)


def _rate_limit(client_ip: str, *, now: float | None = None) -> int | None:
    stamp = now if now is not None else time.time()
    window = _env_int("METADATA_RATE_WINDOW_SECONDS", 600)
    max_hits = _env_int("METADATA_RATE_LIMIT", 6)
    cooldown = _env_int("METADATA_COOLDOWN_SECONDS", 8)
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
