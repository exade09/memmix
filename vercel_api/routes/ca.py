from __future__ import annotations

import base64
import hmac
import json
import os
import time
from collections import defaultdict
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from vercel_api.shared import PROJECT_ROOT

CA_FILE = PROJECT_ROOT / "data" / "ca.json"
CA_MAX_LENGTH = 128
GITHUB_API = "https://api.github.com"
DEFAULT_REPO = "exade09/memmix"
DEFAULT_BRANCH = "main"

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


def _github_token() -> str:
    return (os.getenv("GITHUB_TOKEN") or "").strip()


def _github_repo() -> str:
    return (os.getenv("GITHUB_REPO") or "").strip() or DEFAULT_REPO


def _is_local_dev() -> bool:
    """
    Vercel's filesystem is rebuilt fresh from git on every deploy and is not
    writable in a way that lasts, so a production write has to go through
    GitHub and let the resulting push redeploy. `main.py web` runs on an
    ordinary writable filesystem, so it writes the file directly and the
    change is visible on the next request with no deploy round trip.
    """
    return not (os.getenv("VERCEL") or os.getenv("VERCEL_ENV"))


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

    if _is_local_dev():
        CA_FILE.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
        return {"ca": clean, "updated_at": updated_at, "live_in_seconds": 0}

    token = _github_token()
    if not token:
        raise CaError("Deploy credentials are not configured.", "DEPLOY_UNAVAILABLE")
    _commit_to_github(payload, token=token)
    return {"ca": clean, "updated_at": updated_at, "live_in_seconds": 60}


def _commit_to_github(payload: dict[str, Any], *, token: str) -> None:
    repo = _github_repo()
    rel_path = "data/ca.json"
    url = f"{GITHUB_API}/repos/{repo}/contents/{rel_path}"
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "User-Agent": "fons-ca-admin/1",
        "X-GitHub-Api-Version": "2022-11-28",
    }

    try:
        get_request = Request(f"{url}?ref={DEFAULT_BRANCH}", headers=headers)
        with urlopen(get_request, timeout=10) as response:
            current = json.loads(response.read().decode("utf-8"))
        sha = current.get("sha")
    except HTTPError as exc:
        if exc.code == 404:
            sha = None
        else:
            raise CaError(
                f"Could not reach the deploy target ({_github_error_detail(exc)}).", "DEPLOY_UNAVAILABLE"
            ) from exc
    except (URLError, TimeoutError, json.JSONDecodeError) as exc:
        raise CaError(f"Could not reach the deploy target ({exc}).", "DEPLOY_UNAVAILABLE") from exc

    content = json.dumps(payload, indent=2) + "\n"
    body = {
        "message": "Update contract address",
        "content": base64.b64encode(content.encode("utf-8")).decode("ascii"),
        "branch": DEFAULT_BRANCH,
    }
    if sha:
        body["sha"] = sha

    try:
        put_request = Request(
            url,
            data=json.dumps(body).encode("utf-8"),
            headers={**headers, "Content-Type": "application/json"},
            method="PUT",
        )
        with urlopen(put_request, timeout=15):
            pass
    except HTTPError as exc:
        # GitHub's own error body is safe to surface: it never echoes the
        # token back, and it is the one thing that turns "saving failed"
        # into something actually diagnosable.
        raise CaError(f"Saving failed: {_github_error_detail(exc)}.", "DEPLOY_FAILED") from exc
    except (URLError, TimeoutError) as exc:
        raise CaError(f"Saving failed: {exc}.", "DEPLOY_FAILED") from exc


def _github_error_detail(exc: HTTPError) -> str:
    try:
        raw = exc.read().decode("utf-8", errors="replace")
        parsed = json.loads(raw)
        message = str(parsed.get("message") or raw)
    except (OSError, ValueError):
        message = exc.reason or "unknown error"
    return f"{exc.code} {message}"[:200]
