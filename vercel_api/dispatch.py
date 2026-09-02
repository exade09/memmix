from __future__ import annotations

import json
from urllib.parse import parse_qs

from axiom_scanner.analysis.logical_mixer import MixError
from axiom_scanner.analysis.wavespeed_hybrid import HybridImageError
from axiom_scanner.http_client import SourceError
from axiom_scanner.security.images import ImageError
from axiom_scanner.security.query import QueryError
from axiom_scanner.storage.pinata import MetadataError
from vercel_api.envelope import envelope
from vercel_api.launch_config import RPC_MAX_BODY_BYTES
from vercel_api.routes.avatar import avatar_start_route, avatar_status_route
from vercel_api.routes.feed import feed_tokens
from vercel_api.routes.health import health_payload
from vercel_api.routes.launch import name_check_route
from vercel_api.routes.metadata import metadata_pin_route
from vercel_api.routes.mix import mix_concepts_route
from vercel_api.routes.rpc import chain_rpc_route
from vercel_api.routes.search import search_tokens
from vercel_api.routes.token import token_detail
from vercel_api.shared import runtime_config


def handle_api_get(path: str, query: dict[str, list[str]] | str) -> tuple[int, dict] | None:
    params = parse_qs(query) if isinstance(query, str) else query
    if path == "/api/search":
        return _search(params)
    if path == "/api/feed":
        return _feed(params)
    if path == "/api/mix/avatar/status":
        return _avatar_status(params)
    if path == "/api/launch/name-check":
        return _name_check(params)
    if path == "/api/health":
        data = health_payload()
        dumped = json.dumps(data)
        if "PINATA_JWT" in dumped or "Bearer " in dumped or "sk-" in dumped:
            return 500, envelope(success=False, code="SOURCE_UNAVAILABLE", message="Health check failed.")
        return 200, envelope(success=True, data=data)
    if path.startswith("/api/token/"):
        mint = path.split("/api/token/", 1)[1].strip("/")
        if "/" in mint or not mint:
            return 400, envelope(success=False, code="INVALID_MINT", message="That mint address is not valid.")
        return _token(mint)
    return None


def handle_api_post(
    path: str,
    *,
    read_body=None,
    read_json=None,
    read_multipart=None,
    client_ip: str = "",
    origin: str = "",
    host: str = "",
) -> tuple[int, dict] | None:
    reader = read_json or read_body
    if path == "/api/mix/avatar/start":
        return _avatar_start(read_multipart, client_ip)
    if path == "/api/metadata/pin":
        return _metadata_pin(read_multipart, client_ip)
    if path == "/api/chain/rpc":
        return _chain_rpc(reader, client_ip, origin, host)
    if path != "/api/mix/concepts":
        return None
    try:
        body = reader(max_bytes=32_000)
    except (json.JSONDecodeError, ValueError, TypeError):
        return 400, envelope(success=False, code="INVALID_INPUT", message="Request body must be JSON.")
    if not isinstance(body, dict):
        return 400, envelope(success=False, code="INVALID_INPUT", message="Request body must be JSON.")
    try:
        data = mix_concepts_route(body, client_ip)
    except MixError as exc:
        status = (
            429
            if exc.code == "RATE_LIMITED"
            else 400
            if exc.code in {"INVALID_INPUT", "INVALID_MINT", "DUPLICATE_PARENTS"}
            else 502
        )
        return status, envelope(success=False, code=exc.code, message=str(exc))
    except QueryError as exc:
        return 400, envelope(success=False, code=exc.code, message=str(exc))
    except SourceError:
        return 504, envelope(
            success=False,
            code="AI_UNAVAILABLE",
            message="The logic mixer took too long. Nothing was charged for an avatar.",
        )
    return 200, envelope(success=True, data=data)


def _metadata_pin(read_multipart, client_ip: str) -> tuple[int, dict]:
    if read_multipart is None:
        return 400, envelope(success=False, code="INVALID_INPUT", message="Metadata pin requires multipart form data.")
    try:
        parsed = read_multipart(max_bytes=8_000_000)
        if isinstance(parsed, tuple) and len(parsed) == 2:
            fields, files = parsed
        else:
            raise ValueError("multipart parser returned an unexpected payload")
    except (ValueError, TypeError, json.JSONDecodeError, HybridImageError):
        return 400, envelope(success=False, code="INVALID_INPUT", message="Request body must be multipart form data.")
    try:
        data = metadata_pin_route(
            fields if isinstance(fields, dict) else {},
            files if isinstance(files, dict) else {},
            client_ip,
        )
    except MetadataError as exc:
        return _metadata_error(exc)
    except ImageError as exc:
        return _metadata_error(exc)
    except QueryError as exc:
        return 400, envelope(success=False, code=exc.code, message=str(exc))
    dumped = json.dumps(data)
    if "PINATA_JWT" in dumped or "Bearer " in dumped:
        return 500, envelope(success=False, code="METADATA_PIN_FAILED", message="Metadata pinning failed.")
    return 200, envelope(success=True, data=data)


def _chain_rpc(reader, client_ip: str, origin: str, host: str) -> tuple[int, dict]:
    if reader is None:
        return 400, envelope(success=False, code="INVALID_INPUT", message="Request body must be JSON-RPC.")
    try:
        body = reader(max_bytes=RPC_MAX_BODY_BYTES)
    except (json.JSONDecodeError, ValueError, TypeError) as exc:
        message = "RPC body is too large." if "too large" in str(exc) else "Request body must be JSON-RPC."
        status = 413 if "too large" in str(exc) else 400
        return status, envelope(success=False, code="INVALID_INPUT", message=message)
    return chain_rpc_route(body, client_ip=client_ip, origin=origin, host=host)


def _name_check(params: dict[str, list[str]]) -> tuple[int, dict]:
    name = params.get("name", [""])[0]
    ticker = params.get("ticker", [""])[0]
    data = name_check_route(name, ticker)
    return 200, envelope(success=True, data=data)


def _metadata_error(exc: QueryError) -> tuple[int, dict]:
    status = (
        429
        if exc.code == "RATE_LIMITED"
        else 504
        if exc.code == "METADATA_TIMEOUT"
        else 503
        if exc.code == "METADATA_UNAVAILABLE"
        else 413
        if exc.code in {"IMAGE_TOO_LARGE"}
        else 400
        if exc.code
        in {
            "INVALID_INPUT",
            "INVALID_MINT",
            "MISSING_IMAGE",
            "INVALID_IMAGE",
            "UNSUPPORTED_IMAGE",
            "METADATA_URI_TOO_LONG",
        }
        else 502
    )
    return status, envelope(success=False, code=exc.code, message=str(exc))


def _avatar_start(read_multipart, client_ip: str) -> tuple[int, dict]:
    if read_multipart is None:
        return 400, envelope(success=False, code="INVALID_INPUT", message="Avatar start requires multipart form data.")
    try:
        parsed = read_multipart(max_bytes=12_000_000)
        if isinstance(parsed, tuple) and len(parsed) == 2:
            fields, files = parsed
        else:
            raise ValueError("multipart parser returned an unexpected payload")
    except MixError as exc:
        return _mix_error(exc)
    except (ValueError, TypeError, json.JSONDecodeError, HybridImageError):
        return 400, envelope(success=False, code="INVALID_INPUT", message="Request body must be multipart form data.")
    try:
        data = avatar_start_route(fields if isinstance(fields, dict) else {}, files if isinstance(files, dict) else {}, client_ip)
    except MixError as exc:
        return _mix_error(exc)
    except QueryError as exc:
        return 400, envelope(success=False, code=exc.code, message=str(exc))
    return 200, envelope(success=True, data=data)


def _avatar_status(params: dict[str, list[str]]) -> tuple[int, dict]:
    token = params.get("job", [""])[0]
    try:
        data = avatar_status_route(token)
    except MixError as exc:
        return _mix_error(exc)
    except QueryError as exc:
        return 400, envelope(success=False, code=exc.code, message=str(exc))
    return 200, envelope(success=True, data=data)


def _mix_error(exc: MixError) -> tuple[int, dict]:
    status = (
        429
        if exc.code == "RATE_LIMITED"
        else 504
        if exc.code in {"IMAGE_TIMEOUT", "AI_UNAVAILABLE"}
        else 409
        if exc.code == "DUPLICATE_JOB"
        else 413
        if exc.code == "IMAGE_TOO_LARGE"
        else 400
        if exc.code
        in {
            "INVALID_INPUT",
            "INVALID_MINT",
            "DUPLICATE_PARENTS",
            "INVALID_JOB",
            "MISSING_IMAGE",
            "INVALID_IMAGE",
            "UNSUPPORTED_IMAGE",
            "BLOCKED_URL",
            "IMAGE_URL_UNAVAILABLE",
        }
        else 502
    )
    return status, envelope(success=False, code=exc.code, message=str(exc))


def _search(params: dict[str, list[str]]) -> tuple[int, dict]:
    query = params.get("q", [""])[0]
    limit = _bounded_int(params.get("limit", ["8"])[0], 8, 1, 12)
    try:
        data = search_tokens(query, limit=limit, config=runtime_config())
    except QueryError as exc:
        return 400, envelope(success=False, code=exc.code, message=str(exc))
    except SourceError as exc:
        return _source_status(exc)
    except ValueError as exc:
        return 400, envelope(success=False, code="INVALID_INPUT", message=str(exc))
    except RuntimeError:
        return 502, envelope(
            success=False,
            code="SOURCE_UNAVAILABLE",
            message="The scanner is offline. Try a mint address or retry.",
        )
    return 200, envelope(success=True, data=data)


def _feed(params: dict[str, list[str]]) -> tuple[int, dict]:
    tab = params.get("tab", ["trending"])[0]
    if tab not in {"trending", "new", "mixable"}:
        tab = "trending"
    limit = _bounded_int(params.get("limit", ["24"])[0], 24, 1, 50)
    try:
        data = feed_tokens(
            tab,
            limit,
            min_liquidity=_optional_float(params.get("min_liquidity", [""])[0]),
            min_volume=_optional_float(params.get("min_volume", [""])[0]),
            max_age_hours=_optional_float(params.get("max_age_hours", [""])[0]),
            has_image=_optional_bool(params.get("has_image", [""])[0]),
        )
    except SourceError as exc:
        return _source_status(exc)
    except RuntimeError:
        return 502, envelope(
            success=False,
            code="SOURCE_UNAVAILABLE",
            message="The scanner is offline. Try a mint address or retry.",
        )
    return 200, envelope(success=True, data=data)


def _token(mint: str) -> tuple[int, dict]:
    try:
        data = token_detail(mint, runtime_config())
    except QueryError as exc:
        status = 404 if exc.code == "TOKEN_NOT_FOUND" else 400
        return status, envelope(success=False, code=exc.code, message=str(exc))
    except SourceError as exc:
        return _source_status(exc)
    except RuntimeError:
        return 502, envelope(
            success=False,
            code="SOURCE_UNAVAILABLE",
            message="The scanner is offline. Try a mint address or retry.",
        )
    return 200, envelope(success=True, data=data)


def _source_status(exc: SourceError) -> tuple[int, dict]:
    status = 429 if exc.code == "RATE_LIMITED" else 504 if "timeout" in str(exc).lower() else 502
    message = (
        "The scanner is rate limited. Retry in a moment."
        if exc.code == "RATE_LIMITED"
        else "The scanner is offline. Try a mint address or retry."
    )
    return status, envelope(success=False, code=exc.code, message=message)


def _bounded_int(raw: str, fallback: int, minimum: int, maximum: int) -> int:
    try:
        return max(minimum, min(int(raw), maximum))
    except (TypeError, ValueError):
        return fallback


def _optional_float(raw: str) -> float | None:
    if raw is None or raw == "":
        return None
    try:
        number = float(raw)
    except (TypeError, ValueError):
        return None
    if number < 0 or number > 1_000_000_000_000:
        return None
    return number


def _optional_bool(raw: str) -> bool | None:
    value = (raw or "").strip().lower()
    if value in {"1", "true", "yes"}:
        return True
    if value in {"0", "false", "no"}:
        return False
    return None
