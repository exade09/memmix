from __future__ import annotations

import ipaddress
import socket
from typing import Callable
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin, urlparse
from urllib.request import HTTPRedirectHandler, Request, build_opener

from axiom_scanner.security.query import QueryError


MAX_FETCH_BYTES = 8 * 1024 * 1024
FETCH_TIMEOUT_SECONDS = 10
MAX_REDIRECTS = 3

BLOCKED_HOSTS = {
    "localhost",
    "localhost.localdomain",
    "metadata.google.internal",
    "metadata.google.com",
    "instance-data",
    "metadata",
}

CGNAT = ipaddress.ip_network("100.64.0.0/10")
METADATA_V4 = ipaddress.ip_address("169.254.169.254")
ALIBABA_METADATA = ipaddress.ip_address("100.100.100.200")


class FetchError(QueryError):
    pass


class _Redirect(Exception):
    def __init__(self, location: str, code: int) -> None:
        super().__init__(location)
        self.location = location
        self.code = code


class _NoFollow(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):  # type: ignore[no-untyped-def]
        location = headers.get("Location") or newurl
        raise _Redirect(str(location), int(code))


Resolver = Callable[..., list]


def fetch_public_bytes(
    url: str,
    *,
    resolver: Resolver | None = None,
    opener_factory=None,
    max_bytes: int = MAX_FETCH_BYTES,
    timeout_seconds: int = FETCH_TIMEOUT_SECONDS,
) -> tuple[bytes, str, str]:
    current = url.strip()
    seen: set[str] = set()
    resolve = resolver or socket.getaddrinfo
    factory = opener_factory or (lambda: build_opener(_NoFollow))

    for _ in range(MAX_REDIRECTS + 1):
        if current in seen:
            raise FetchError("Image URL redirected in a loop.", "BLOCKED_URL")
        seen.add(current)
        assert_public_url(current, resolver=resolve)
        request = Request(current, headers={"User-Agent": "mixborn-image-fetcher/1.0"})
        opener = factory()
        try:
            with opener.open(request, timeout=timeout_seconds) as response:
                data = response.read(max_bytes + 1)
                if len(data) > max_bytes:
                    raise FetchError("Remote image is too large.", "IMAGE_TOO_LARGE")
                header_type = ""
                try:
                    header_type = response.headers.get_content_type()
                except Exception:
                    header_type = str(response.headers.get("Content-Type") or "")
                final_url = str(getattr(response, "geturl", lambda: current)())
                return data, final_url, header_type.split(";", 1)[0].strip().lower()
        except _Redirect as redirect:
            current = urljoin(current, redirect.location)
            continue
        except HTTPError as exc:
            if exc.code in {301, 302, 303, 307, 308}:
                location = exc.headers.get("Location") if exc.headers else None
                if not location:
                    raise FetchError("Image host redirected without a location.", "BLOCKED_URL") from exc
                current = urljoin(current, location)
                continue
            raise FetchError("Could not load that image URL.", "IMAGE_URL_UNAVAILABLE") from exc
        except (TimeoutError, URLError, OSError) as exc:
            raise FetchError("Could not load that image URL.", "IMAGE_URL_UNAVAILABLE") from exc

    raise FetchError("Too many image redirects.", "BLOCKED_URL")


def assert_public_url(url: str, *, resolver: Resolver | None = None) -> None:
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"}:
        raise FetchError("Only http and https image URLs are allowed.", "BLOCKED_URL")
    if parsed.username or parsed.password:
        raise FetchError("Image URLs may not include credentials.", "BLOCKED_URL")
    host = (parsed.hostname or "").strip().lower().strip("[]")
    if not host:
        raise FetchError("Image URL is missing a host.", "BLOCKED_URL")
    if host in BLOCKED_HOSTS or host.endswith(".localhost") or host.endswith(".internal") or host.endswith(".local"):
        raise FetchError("That image host is not allowed.", "BLOCKED_URL")
    if host == "0.0.0.0" or host.startswith("127."):
        raise FetchError("That image host is not allowed.", "BLOCKED_URL")

    try:
        literal = ipaddress.ip_address(host)
    except ValueError:
        literal = None
    if literal is not None and _blocked_ip(literal):
        raise FetchError("That image host is not allowed.", "BLOCKED_URL")

    resolve = resolver or socket.getaddrinfo
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    try:
        answers = resolve(host, port, type=socket.SOCK_STREAM)
    except (socket.gaierror, OSError, TimeoutError) as exc:
        raise FetchError("Could not resolve that image host.", "IMAGE_URL_UNAVAILABLE") from exc
    if not answers:
        raise FetchError("Could not resolve that image host.", "IMAGE_URL_UNAVAILABLE")
    for item in answers:
        ip = ipaddress.ip_address(item[4][0])
        if _blocked_ip(ip):
            raise FetchError("That image host is not allowed.", "BLOCKED_URL")


def _blocked_ip(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
        ip = ip.ipv4_mapped
    if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_multicast:
        return True
    if ip.is_reserved or ip.is_unspecified:
        return True
    if ip in {METADATA_V4, ALIBABA_METADATA}:
        return True
    try:
        if ip.version == 4 and ip in CGNAT:
            return True
    except Exception:
        return True
    return False
