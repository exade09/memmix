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


class SourceMalformed(SourceError):
    code = "SOURCE_UNAVAILABLE"


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
                    last_error = SourceRateLimited(f"GET failed for {url}: rate limited")
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
                    last_error = SourceRateLimited(f"POST failed for {url}: rate limited")
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
