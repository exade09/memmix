from __future__ import annotations

import os
import time
from collections import defaultdict
from typing import Any

from axiom_scanner.analysis.logical_mixer import MixError, mix_concepts
from axiom_scanner.security.fields import USER_HINT_MAX, sanitize_parent_text
from axiom_scanner.security.query import QueryError


_HITS: dict[str, list[float]] = defaultdict(list)
_LAST: dict[str, float] = {}
_CACHE: dict[str, tuple[float, dict[str, Any]]] = {}


def reset_mix_limits() -> None:
    _HITS.clear()
    _LAST.clear()
    _CACHE.clear()


def mix_concepts_route(body: dict[str, Any], client_ip: str) -> dict[str, Any]:
    retry_after = _rate_limit(client_ip)
    if retry_after is not None:
        raise MixError(
            f"The lab needs a short cooldown. Try again in {retry_after} seconds.",
            "RATE_LIMITED",
        )
    parent_a = body.get("parent_a")
    parent_b = body.get("parent_b")
    if not isinstance(parent_a, dict) or not isinstance(parent_b, dict):
        raise QueryError("Parent A and Parent B are required.")
    hint = sanitize_parent_text(body.get("user_hint") or "", USER_HINT_MAX)
    cache_key = _cache_key(parent_a, parent_b, hint)
    cached = _CACHE.get(cache_key)
    now = time.time()
    if cached and now - cached[0] < 600:
        return cached[1]
    result = mix_concepts(parent_a, parent_b, user_hint=hint)
    if not result.get("fallback"):
        _CACHE[cache_key] = (now, result)
    return result


def _rate_limit(client_ip: str) -> int | None:
    now = time.time()
    window = _env_int("MIX_RATE_WINDOW_SECONDS", 600)
    max_hits = _env_int("MIX_RATE_LIMIT", 10)
    cooldown = _env_int("MIX_COOLDOWN_SECONDS", 8)
    ip = client_ip or "unknown"
    last = _LAST.get(ip, 0.0)
    if now - last < cooldown:
        return max(1, int(cooldown - (now - last)))
    hits = [stamp for stamp in _HITS[ip] if now - stamp < window]
    if len(hits) >= max_hits:
        oldest = min(hits)
        return max(1, int(window - (now - oldest)))
    hits.append(now)
    _HITS[ip] = hits
    _LAST[ip] = now
    return None


def _cache_key(parent_a: dict[str, Any], parent_b: dict[str, Any], hint: str) -> str:
    a = str(parent_a.get("mint") or "").lower()
    b = str(parent_b.get("mint") or "").lower()
    return f"{a}:{b}:{hint.lower()}"


def _env_int(name: str, default: int) -> int:
    try:
        return max(1, int(os.getenv(name, str(default))))
    except ValueError:
        return default
