from __future__ import annotations

"""
Writing a small JSON file that has to survive a deploy.

Vercel's filesystem is rebuilt from git on every deploy and is not writable in
a way that lasts, so anything the admin edits has to be committed back to the
repository; the resulting push redeploys and the new value ships with it.
Locally there is an ordinary writable filesystem, so the file is written
directly and the change is live on the very next request.

That difference is why saving reports how long the value takes to appear:
zero locally, about a minute in production. A save that looks instant but
takes a minute to land is the kind of thing that gets clicked three times.
"""

import base64
import json
import os
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

GITHUB_API = "https://api.github.com"
DEFAULT_REPO = "exade09/memmix"
DEFAULT_BRANCH = "main"


class StoreError(RuntimeError):
    def __init__(self, message: str, code: str) -> None:
        super().__init__(message)
        self.code = code


def is_local_dev() -> bool:
    return not (os.getenv("VERCEL") or os.getenv("VERCEL_ENV"))


def github_token() -> str:
    return (os.getenv("GITHUB_TOKEN") or "").strip()


def github_repo() -> str:
    return (os.getenv("GITHUB_REPO") or DEFAULT_REPO).strip() or DEFAULT_REPO


def save_json(
    *,
    path: Path,
    rel_path: str,
    payload: dict[str, Any],
    message: str,
) -> int:
    """
    Persist `payload`, and report how many seconds until it is live.

    Returns 0 when it was written straight to disk, or roughly the deploy time
    when it had to go through GitHub.
    """
    content = json.dumps(payload, indent=2) + "\n"

    if is_local_dev():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
        return 0

    token = github_token()
    if not token:
        raise StoreError("Deploy credentials are not configured.", "DEPLOY_UNAVAILABLE")
    _commit(rel_path=rel_path, content=content, message=message, token=token)
    return 60


def _commit(*, rel_path: str, content: str, message: str, token: str) -> None:
    url = f"{GITHUB_API}/repos/{github_repo()}/contents/{rel_path}"
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "User-Agent": "fons-admin/1",
        "X-GitHub-Api-Version": "2022-11-28",
    }

    # An existing file needs its current sha, or GitHub refuses the write.
    # A missing one is not an error: the first save creates it.
    try:
        with urlopen(Request(f"{url}?ref={DEFAULT_BRANCH}", headers=headers), timeout=10) as response:
            sha = json.loads(response.read().decode("utf-8")).get("sha")
    except HTTPError as exc:
        if exc.code != 404:
            raise StoreError(
                f"Could not reach the deploy target ({error_detail(exc)}).", "DEPLOY_UNAVAILABLE"
            ) from exc
        sha = None
    except (URLError, TimeoutError, json.JSONDecodeError) as exc:
        raise StoreError(f"Could not reach the deploy target ({exc}).", "DEPLOY_UNAVAILABLE") from exc

    body: dict[str, Any] = {
        "message": message,
        "content": base64.b64encode(content.encode("utf-8")).decode("ascii"),
        "branch": DEFAULT_BRANCH,
    }
    if sha:
        body["sha"] = sha

    try:
        request = Request(
            url,
            data=json.dumps(body).encode("utf-8"),
            headers={**headers, "Content-Type": "application/json"},
            method="PUT",
        )
        with urlopen(request, timeout=15):
            pass
    except HTTPError as exc:
        # GitHub's own error body is safe to surface: it never echoes the
        # token back, and it is the one thing that turns "saving failed" into
        # something actually diagnosable.
        raise StoreError(f"Saving failed: {error_detail(exc)}.", "DEPLOY_FAILED") from exc
    except (URLError, TimeoutError) as exc:
        raise StoreError(f"Saving failed: {exc}.", "DEPLOY_FAILED") from exc


def error_detail(exc: HTTPError) -> str:
    try:
        raw = exc.read().decode("utf-8", errors="replace")
        message = str(json.loads(raw).get("message") or raw)
    except (OSError, ValueError):
        message = exc.reason or "unknown error"
    return f"{exc.code} {message}"[:200]
