from __future__ import annotations

import json
import os
import re
import uuid
from typing import Protocol
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen

from axiom_scanner.http_client import SourceTimeout
from axiom_scanner.security.query import QueryError


PINATA_PIN_URL = "https://api.pinata.cloud/pinning/pinFileToIPFS"
DEFAULT_GATEWAY = "https://gateway.pinata.cloud/ipfs"
METADATA_URI_MAX = 200
CID_V0_RE = re.compile(r"^Qm[1-9A-HJ-NP-Za-km-z]{44}$")
CID_V1_RE = re.compile(r"^baf[a-z0-9]{20,80}$")


class MetadataError(QueryError):
    pass


class Pinner(Protocol):
    def pin_file(self, data: bytes, filename: str, content_type: str) -> str: ...


def pinata_jwt() -> str:
    return (os.getenv("PINATA_JWT") or "").strip()


def pinata_timeout_seconds() -> int:
    try:
        return max(5, min(int(os.getenv("PINATA_TIMEOUT_SECONDS", "20")), 60))
    except ValueError:
        return 20


def public_ipfs_gateway() -> str:
    gateway = (os.getenv("PUBLIC_IPFS_GATEWAY") or "").strip()
    if gateway:
        return gateway
    host = (os.getenv("PINATA_GATEWAY_HOST") or "").strip()
    if host:
        return host
    return DEFAULT_GATEWAY


def validate_cid(cid: str) -> str:
    value = (cid or "").strip()
    if CID_V0_RE.fullmatch(value) or CID_V1_RE.fullmatch(value):
        return value
    raise MetadataError("Pinata returned an unusable CID.", "METADATA_PIN_FAILED")


def gateway_uri(cid: str, gateway: str | None = None) -> str:
    identity = validate_cid(cid)
    base = (gateway or public_ipfs_gateway()).strip()
    if not base:
        raise MetadataError("IPFS gateway is not configured.", "METADATA_UNAVAILABLE")
    if "://" in base:
        parsed = urlparse(base)
    else:
        host_part = base.split("/", 1)[0]
        if ":" in host_part and not host_part.startswith("["):
            raise MetadataError("IPFS gateway must be https.", "METADATA_PIN_FAILED")
        parsed = urlparse(f"https://{base}")
    if parsed.scheme != "https":
        raise MetadataError("IPFS gateway must be https.", "METADATA_PIN_FAILED")
    if parsed.username or parsed.password:
        raise MetadataError("IPFS gateway may not include credentials.", "METADATA_PIN_FAILED")
    host = (parsed.hostname or "").strip().lower()
    if not host or host in {"localhost", "127.0.0.1"} or host.endswith(".local") or host.endswith(".internal"):
        raise MetadataError("IPFS gateway host is not allowed.", "METADATA_PIN_FAILED")
    path = (parsed.path or "").rstrip("/")
    if path.endswith("/ipfs"):
        prefix = f"https://{host}{path}"
    elif path:
        prefix = f"https://{host}{path}/ipfs"
    else:
        prefix = f"https://{host}/ipfs"
    uri = f"{prefix}/{identity}"
    if len(uri) > METADATA_URI_MAX:
        raise MetadataError("Metadata URI exceeds the 200-character Pump limit.", "METADATA_URI_TOO_LONG")
    return uri


class PinataPinner:
    def __init__(self, *, jwt: str | None = None, timeout_seconds: int | None = None) -> None:
        self._jwt = (jwt if jwt is not None else pinata_jwt()).strip()
        self._timeout = timeout_seconds if timeout_seconds is not None else pinata_timeout_seconds()

    def pin_file(self, data: bytes, filename: str, content_type: str) -> str:
        if not self._jwt:
            raise MetadataError("Metadata pinning is not configured.", "METADATA_UNAVAILABLE")
        if not data:
            raise MetadataError("Nothing to pin.", "INVALID_INPUT")
        boundary = f"----mixborn-pinata-{uuid.uuid4().hex}"
        safe_name = re.sub(r"[^A-Za-z0-9._-]", "_", filename or "file.bin")[:80] or "file.bin"
        mime = content_type or "application/octet-stream"
        body = b"".join(
            [
                (
                    f"--{boundary}\r\n"
                    f'Content-Disposition: form-data; name="file"; filename="{safe_name}"\r\n'
                    f"Content-Type: {mime}\r\n\r\n"
                ).encode("utf-8"),
                data,
                b"\r\n",
                (
                    f"--{boundary}\r\n"
                    'Content-Disposition: form-data; name="pinataMetadata"\r\n\r\n'
                    f"{json.dumps({'name': safe_name})}\r\n"
                ).encode("utf-8"),
                (
                    f"--{boundary}\r\n"
                    'Content-Disposition: form-data; name="pinataOptions"\r\n\r\n'
                    f"{json.dumps({'cidVersion': 1})}\r\n"
                    f"--{boundary}--\r\n"
                ).encode("utf-8"),
            ]
        )
        headers = {
            "Accept": "application/json",
            "Authorization": f"Bearer {self._jwt}",
            "Content-Type": f"multipart/form-data; boundary={boundary}",
            "Content-Length": str(len(body)),
            "User-Agent": "mixborn-metadata/0.1",
        }
        request = Request(PINATA_PIN_URL, data=body, headers=headers, method="POST")
        try:
            with urlopen(request, timeout=self._timeout) as response:
                raw = response.read().decode("utf-8")
        except TimeoutError as exc:
            raise MetadataError("Pinata timed out.", "METADATA_TIMEOUT") from exc
        except HTTPError as exc:
            raise MetadataError("Metadata pinning failed.", "METADATA_PIN_FAILED") from exc
        except URLError as exc:
            reason = getattr(exc, "reason", exc)
            if isinstance(reason, TimeoutError) or "timed out" in str(reason).lower():
                raise MetadataError("Pinata timed out.", "METADATA_TIMEOUT") from exc
            raise MetadataError("Metadata pinning failed.", "METADATA_PIN_FAILED") from exc
        except SourceTimeout as exc:
            raise MetadataError("Pinata timed out.", "METADATA_TIMEOUT") from exc
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise MetadataError("Pinata returned unreadable JSON.", "METADATA_PIN_FAILED") from exc
        if not isinstance(payload, dict):
            raise MetadataError("Pinata returned an unexpected payload.", "METADATA_PIN_FAILED")
        return validate_cid(str(payload.get("IpfsHash") or payload.get("cid") or ""))
