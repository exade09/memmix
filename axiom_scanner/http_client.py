from __future__ import annotations

import json
import time
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


class SourceError(RuntimeError):
    code = "SOURCE_UNAVAILABLE"

    def __init__(self, message: str, code: str | None = None) -> None:
        super().__init__(message)
        if code:
            self.code = code


class SourceTimeout(SourceError):
    code = "SOURCE_UNAVAILABLE"


class SourceRateLimited(SourceError):
    code = "RATE_LIMITED"


class SourceQuotaExhausted(SourceError):
    """
    The account is out of credit, not going too fast.

    Providers report both as HTTP 429, which makes them look identical to a
    retry loop -- but they are opposites. A rate limit clears on its own in
    seconds; an empty balance never clears, and telling a visitor to "try
    again in a moment" is an instruction that can only ever waste their time.

    Deliberately not a subclass of SourceRateLimited, so a caller that
    handles rate limiting specially treats this as a plain outage and falls
    back instead.
    """

    code = "SOURCE_UNAVAILABLE"


class SourceMalformed(SourceError):
    code = "SOURCE_UNAVAILABLE"


# Body markers providers use for "you are out of credit" on a 429.
_QUOTA_MARKERS = ("insufficient_quota", "billing_hard_limit_reached", "exceeded_current_quota")


def _classify_429(exc: HTTPError, what: str) -> SourceError:
    """Tell an empty balance apart from going too fast."""
    try:
        body = exc.read().decode("utf-8", errors="replace").lower()
    except (OSError, ValueError):
        body = ""
    if any(marker in body for marker in _QUOTA_MARKERS):
        return SourceQuotaExhausted(f"{what}: the API account is out of quota")
    return SourceRateLimited(f"{what}: rate limited")


class HttpClient:
    def __init__(self, timeout_seconds: int = 12, retries: int = 2) -> None:
        self.timeout_seconds = timeout_seconds
        self.retries = retries

    def get_json(self, url: str) -> Any:
        last_error: Exception | None = None

        for attempt in range(self.retries + 1):
            try:
                request = Request(
                    url,
                    headers={
                        "Accept": "application/json",
                        "User-Agent": "mixborn-scanner/0.1",
                    },
                )
                with urlopen(request, timeout=self.timeout_seconds) as response:
                    body = response.read().decode("utf-8")
                    try:
                        return json.loads(body)
                    except json.JSONDecodeError as exc:
                        raise SourceMalformed(f"GET failed for {url}: malformed JSON") from exc
            except SourceMalformed:
                raise
            except HTTPError as exc:
                last_error = exc
                if exc.code == 429:
                    last_error = _classify_429(exc, f"GET failed for {url}")
                    if isinstance(last_error, SourceQuotaExhausted):
                        # Retrying an empty balance only burns the request's
                        # time budget; nothing about it will change.
                        raise last_error from exc
                if attempt < self.retries:
                    time.sleep(0.6 * (attempt + 1))
                    continue
            except (URLError, TimeoutError) as exc:
                last_error = SourceTimeout(f"GET failed for {url}: timeout")
                last_error.__cause__ = exc
                if attempt < self.retries:
                    time.sleep(0.6 * (attempt + 1))
                    continue

        if isinstance(last_error, SourceError):
            raise last_error
        raise SourceError(f"GET failed for {url}: {last_error}") from last_error

    def post_json(self, url: str, payload: dict[str, Any], *, headers: dict[str, str] | None = None) -> Any:
        last_error: Exception | None = None
        request_headers = {
            "Accept": "application/json",
            "Content-Type": "application/json",
            "User-Agent": "mixborn-scanner/0.1",
        }
        if headers:
            request_headers.update(headers)
        body = json.dumps(payload).encode("utf-8")

        for attempt in range(self.retries + 1):
            try:
                request = Request(url, data=body, method="POST", headers=request_headers)
                with urlopen(request, timeout=self.timeout_seconds) as response:
                    raw = response.read().decode("utf-8")
                    try:
                        return json.loads(raw)
                    except json.JSONDecodeError as exc:
                        raise SourceMalformed(f"POST failed for {url}: malformed JSON") from exc
            except SourceMalformed:
                raise
            except HTTPError as exc:
                last_error = exc
                if exc.code == 429:
                    last_error = _classify_429(exc, f"POST failed for {url}")
                    if isinstance(last_error, SourceQuotaExhausted):
                        raise last_error from exc
                elif exc.code and 400 <= exc.code < 500:
                    raise SourceError(f"POST failed for {url}: HTTP {exc.code}", "SOURCE_UNAVAILABLE") from exc
                if attempt < self.retries:
                    time.sleep(0.6 * (attempt + 1))
                    continue
            except (URLError, TimeoutError) as exc:
                last_error = SourceTimeout(f"POST failed for {url}: timeout")
                last_error.__cause__ = exc
                if attempt < self.retries:
                    time.sleep(0.6 * (attempt + 1))
                    continue

        if isinstance(last_error, SourceError):
            raise last_error
        raise SourceError(f"POST failed for {url}: {last_error}") from last_error
