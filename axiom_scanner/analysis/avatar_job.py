from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import time
from typing import Any, Protocol

from axiom_scanner.analysis.logical_mixer import MixError
from axiom_scanner.analysis.mix_schema import AVATAR_PROMPT_TEMPLATE, AVATAR_STYLE
from axiom_scanner.analysis.wavespeed_hybrid import (
    HybridImage,
    HybridImageError,
    WAVESPEED_PRIMARY_MODEL,
    fetch_prediction_once,
    get_wavespeed_api_keys,
    log_hybrid_event,
    normalize_image_for_provider,
    submit_seedream_edit,
    upload_images,
)
from axiom_scanner.security.fields import (
    HOOK_MAX,
    TRAIT_MAX,
    VISUAL_PROMPT_MAX,
    sanitize_parent_text,
)
from axiom_scanner.security.fetch import FetchError, assert_public_url, fetch_public_bytes
from axiom_scanner.security.images import ImageError, MAX_UPLOAD_BYTES, normalize_reference_image, sniff_image_mime


JOB_TTL_SECONDS = 180
POLL_AFTER_MS = 1500
INJECTION_RE = re.compile(
    r"(ignore (all )?(previous|prior|above) instructions|system prompt|you are now)",
    re.IGNORECASE,
)


class AvatarProvider(Protocol):
    def upload_images(self, images: list[HybridImage]) -> list[str]: ...

    def submit(self, image_urls: list[str], prompt: str, size: str) -> dict[str, Any]: ...

    def poll_once(self, request_id: str) -> dict[str, Any]: ...


_INFLIGHT: dict[str, tuple[str, float]] = {}
_RESULTS: dict[str, dict[str, Any]] = {}
_SEEN_NONCES: dict[str, float] = {}


def reset_avatar_jobs() -> None:
    _INFLIGHT.clear()
    _RESULTS.clear()
    _SEEN_NONCES.clear()


def start_avatar_job(
    *,
    fields: dict[str, str],
    files: dict[str, HybridImage],
    client_ip: str,
    provider: AvatarProvider | None = None,
    now: float | None = None,
) -> dict[str, Any]:
    stamp = now if now is not None else time.time()
    ip = client_ip or "unknown"
    _purge(stamp)
    existing = _INFLIGHT.get(ip)
    if existing and stamp - existing[1] < JOB_TTL_SECONDS:
        job_id, started = existing
        cached = _RESULTS.get(job_id)
        status = str((cached or {}).get("status") or "processing")
        if status in {"queued", "processing"}:
            raise MixError("One avatar is already drawing.", "DUPLICATE_JOB")

    if (fields.get("style") or AVATAR_STYLE).strip() not in {"", AVATAR_STYLE}:
        raise MixError("Avatar style is fixed.", "INVALID_INPUT")

    hmac_key = _hmac_secret()
    api_keys = get_wavespeed_api_keys()
    if not hmac_key or not api_keys:
        raise MixError(
            "This combination could not be rendered. Edit the concept or upload an image.",
            "IMAGE_UNAVAILABLE",
        )

    image_a = _resolve_parent_image("parent_a", fields, files)
    image_b = _resolve_parent_image("parent_b", fields, files)
    prompt = build_avatar_prompt(fields)
    size = "1024*1024"
    client = provider or WaveSpeedAvatarProvider(api_keys[0])

    try:
        urls = client.upload_images([image_a, image_b])
        submitted = client.submit(urls, prompt, size)
    except HybridImageError as exc:
        log_hybrid_event("avatar_failed", code=exc.code, status=exc.status)
        if exc.code in {"wavespeed_unreachable", "generation_timeout"}:
            raise MixError(
                "The drawing is still processing. You can keep this tab open or retry later.",
                "IMAGE_TIMEOUT",
            ) from exc
        raise MixError(
            "This combination could not be rendered. Edit the concept or upload an image.",
            "IMAGE_REJECTED",
        ) from exc

    data = submitted.get("data") if isinstance(submitted, dict) else {}
    if not isinstance(data, dict):
        raise MixError(
            "This combination could not be rendered. Edit the concept or upload an image.",
            "IMAGE_REJECTED",
        )
    request_id = str(data.get("id") or "")
    if not request_id:
        raise MixError(
            "This combination could not be rendered. Edit the concept or upload an image.",
            "IMAGE_REJECTED",
        )

    iat = int(stamp)
    nonce = secrets.token_hex(8)
    token = sign_job_token(request_id, iat=iat, nonce=nonce, secret=hmac_key)
    _SEEN_NONCES[nonce] = stamp
    _INFLIGHT[ip] = (request_id, stamp)
    status = str(data.get("status") or "queued")
    if status not in {"queued", "processing", "created", "pending"}:
        status = "queued"
    _RESULTS[request_id] = {
        "status": "queued",
        "issued_at": stamp,
        "expires_at": stamp + JOB_TTL_SECONDS,
        "client_ip": ip,
        "prompt_hash": hashlib.sha256(prompt.encode("utf-8")).hexdigest(),
    }
    log_hybrid_event("avatar_submitted", request_id=request_id, bytes_a=len(image_a.data), bytes_b=len(image_b.data))
    return {
        "job_token": token,
        "status": "queued",
        "poll_after_ms": POLL_AFTER_MS,
    }


def avatar_job_status(
    token: str,
    *,
    provider: AvatarProvider | None = None,
    now: float | None = None,
    hmac_secret: bytes | None = None,
) -> dict[str, Any]:
    stamp = now if now is not None else time.time()
    try:
        payload = verify_job_token(token, now=stamp, secret=hmac_secret)
    except MixError as exc:
        if exc.code == "JOB_EXPIRED":
            return _public_status("expired")
        raise
    job_id = payload["id"]
    cached = _RESULTS.get(job_id)
    if cached and cached.get("status") == "completed" and stamp <= float(cached.get("expires_at") or 0):
        return cached["public"]
    if stamp > payload["iat"] + JOB_TTL_SECONDS:
        _clear_job(job_id)
        return _public_status("expired")

    api_keys = get_wavespeed_api_keys()
    client = provider or (WaveSpeedAvatarProvider(api_keys[0]) if api_keys else None)
    if client is None:
        return _public_status("failed", code="IMAGE_UNAVAILABLE")

    try:
        result = client.poll_once(job_id)
    except HybridImageError as exc:
        if exc.code in {"wavespeed_unreachable", "generation_timeout"}:
            return _public_status("processing", message="The drawing is still processing. You can keep this tab open or retry later.")
        return _public_status("failed", code="IMAGE_REJECTED")
    except (TypeError, ValueError, json.JSONDecodeError):
        return _public_status("failed", code="IMAGE_REJECTED")

    if not isinstance(result, dict):
        return _public_status("failed", code="IMAGE_REJECTED")
    data = result.get("data")
    if not isinstance(data, dict):
        return _public_status("failed", code="IMAGE_REJECTED")
    raw_status = str(data.get("status") or "").lower()
    if raw_status in {"failed", "error"}:
        _finish_job(job_id, "failed")
        return _public_status("failed", code="IMAGE_REJECTED")
    if raw_status in {"queued", "created", "pending", "processing", "running"}:
        mapped = "queued" if raw_status in {"queued", "created", "pending"} else "processing"
        return _public_status(mapped)
    if raw_status != "completed":
        return _public_status("processing")

    outputs = data.get("outputs") or []
    if not outputs or not isinstance(outputs[0], str):
        _finish_job(job_id, "failed")
        return _public_status("failed", code="IMAGE_REJECTED")
    display_url = outputs[0].strip()
    try:
        assert_public_url(display_url)
        raw, _, _ = fetch_public_bytes(display_url)
        mime = sniff_image_mime(raw)
        png, content_type, width, height = normalize_reference_image(raw, "avatar", claimed_type=mime)
        del png
    except (FetchError, ImageError, MixError):
        _finish_job(job_id, "failed")
        return _public_status("failed", code="IMAGE_REJECTED")

    public = {
        "status": "completed",
        "image_url": display_url,
        "width": width,
        "height": height,
        "content_type": content_type,
        "output_hash": hashlib.sha256(raw).hexdigest(),
    }
    expires = payload["iat"] + JOB_TTL_SECONDS
    _RESULTS[job_id] = {"status": "completed", "expires_at": expires, "public": public, "issued_at": payload["iat"]}
    _clear_inflight_for(job_id)
    log_hybrid_event("avatar_completed", request_id=job_id, width=width, height=height)
    return public


def sign_job_token(
    provider_id: str,
    *,
    iat: int,
    nonce: str,
    secret: bytes | None = None,
) -> str:
    key = secret if secret is not None else _hmac_secret()
    if not key:
        raise MixError("Avatar jobs are unavailable.", "IMAGE_UNAVAILABLE")
    body = _token_body({"id": provider_id, "iat": int(iat), "n": nonce})
    signature = hmac.new(key, body, hashlib.sha256).digest()
    return _b64(body) + "." + _b64(signature)


def verify_job_token(
    token: str,
    *,
    now: float | None = None,
    secret: bytes | None = None,
    ttl_seconds: int = JOB_TTL_SECONDS,
) -> dict[str, Any]:
    key = secret if secret is not None else _hmac_secret()
    if not key:
        raise MixError("That avatar job is not valid.", "INVALID_JOB")
    parts = (token or "").split(".")
    if len(parts) != 2:
        raise MixError("That avatar job is not valid.", "INVALID_JOB")
    try:
        body = _unb64(parts[0])
        signature = _unb64(parts[1])
    except (ValueError, OSError) as exc:
        raise MixError("That avatar job is not valid.", "INVALID_JOB") from exc
    expected = hmac.new(key, body, hashlib.sha256).digest()
    if not hmac.compare_digest(signature, expected):
        raise MixError("That avatar job is not valid.", "INVALID_JOB")
    try:
        payload = json.loads(body.decode("utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise MixError("That avatar job is not valid.", "INVALID_JOB") from exc
    if not isinstance(payload, dict) or not payload.get("id") or not payload.get("n"):
        raise MixError("That avatar job is not valid.", "INVALID_JOB")
    try:
        iat = int(payload["iat"])
    except (KeyError, TypeError, ValueError) as exc:
        raise MixError("That avatar job is not valid.", "INVALID_JOB") from exc
    stamp = now if now is not None else time.time()
    if iat > stamp + 30:
        raise MixError("That avatar job is not valid.", "INVALID_JOB")
    if stamp > iat + ttl_seconds:
        raise MixError("That avatar job has expired.", "JOB_EXPIRED")
    nonce = str(payload["n"])
    seen = _SEEN_NONCES.get(nonce)
    if seen is None:
        # Unknown nonce is still valid if HMAC matches (status after process restart).
        _SEEN_NONCES[nonce] = float(iat)
    return {"id": str(payload["id"]), "iat": iat, "n": nonce}


def build_avatar_prompt(fields: dict[str, str]) -> str:
    hook = _clean_trait(fields.get("character_hook") or fields.get("name") or "one original mascot", HOOK_MAX)
    a_trait = _clean_trait(fields.get("parent_a_trait") or "a readable silhouette", TRAIT_MAX)
    b_trait = _clean_trait(fields.get("parent_b_trait") or "a signature prop", TRAIT_MAX)
    extra = _clean_trait(fields.get("visual_prompt") or "", VISUAL_PROMPT_MAX)
    prompt = AVATAR_PROMPT_TEMPLATE.format(
        character_hook=hook,
        parent_a_trait=a_trait,
        parent_b_trait=b_trait,
    )
    if extra:
        prompt += f"\nAdditional silhouette direction: {extra}"
    return prompt.strip()


def persistable_draft_token(draft: dict[str, Any]) -> dict[str, Any]:
    url = str(draft.get("avatar_url") or "").strip()
    if url.startswith("blob:") or url.startswith("data:"):
        url = ""
    allowed = {
        "source": draft.get("source") or "direct",
        "name": draft.get("name") or "",
        "ticker": draft.get("ticker") or "",
        "description": draft.get("description") or "",
        "twitter": draft.get("twitter") or "",
        "telegram": draft.get("telegram") or "",
        "website": draft.get("website") or "",
        "parent_a_mint": draft.get("parent_a_mint") or "",
        "parent_b_mint": draft.get("parent_b_mint") or "",
        "mix_strategy": draft.get("mix_strategy") or "",
        "generated": bool(draft.get("generated")),
        "avatar_url": url,
        "initial_buy_sol": str(draft.get("initial_buy_sol") or "0"),
    }
    return {
        key: value
        for key, value in allowed.items()
        if value != "" or key in {"name", "ticker", "description", "source", "generated", "avatar_url", "initial_buy_sol"}
    }


def missing_avatar_after_reload(*, stored_url: str, has_memory_blob: bool) -> bool:
    return not has_memory_blob and not str(stored_url or "").strip()


class WaveSpeedAvatarProvider:
    def __init__(self, api_key: str) -> None:
        self.api_key = api_key

    def upload_images(self, images: list[HybridImage]) -> list[str]:
        return upload_images(images, api_key=self.api_key)

    def submit(self, image_urls: list[str], prompt: str, size: str) -> dict[str, Any]:
        return submit_seedream_edit(
            image_urls=image_urls,
            prompt=prompt,
            size=size,
            api_key=self.api_key,
            model=WAVESPEED_PRIMARY_MODEL,
            sync_mode=False,
            timeout_seconds=25,
        )

    def poll_once(self, request_id: str) -> dict[str, Any]:
        return fetch_prediction_once(request_id, api_key=self.api_key)


def _resolve_parent_image(
    side: str,
    fields: dict[str, str],
    files: dict[str, HybridImage],
) -> HybridImage:
    field_file = f"{side}_image"
    field_url = f"{side}_url"
    uploaded = files.get(field_file)
    if uploaded and uploaded.data:
        if len(uploaded.data) > MAX_UPLOAD_BYTES:
            raise MixError(f"{side} image is too large.", "IMAGE_TOO_LARGE")
        try:
            png, content_type, _, _ = normalize_reference_image(
                uploaded.data,
                side,
                claimed_type=uploaded.content_type,
            )
        except ImageError as exc:
            raise MixError(str(exc), exc.code) from exc
        hybrid = HybridImage(
            field_name=side,
            filename=f"{side}.png",
            content_type=content_type,
            data=png,
        )
        return normalize_image_for_provider(hybrid)

    url = (fields.get(field_url) or "").strip()
    if not url:
        raise MixError(
            "This token has no usable image. Upload one to continue.",
            "MISSING_IMAGE",
        )
    if url.startswith("/assets/") and url.lower().endswith(".svg"):
        raise MixError(
            "This token has no usable image. Upload one to continue.",
            "MISSING_IMAGE",
        )
    try:
        raw, final_url, header_type = fetch_public_bytes(url)
        png, content_type, _, _ = normalize_reference_image(raw, side, claimed_type=header_type)
    except FetchError as exc:
        raise MixError("That image host is not allowed." if exc.code == "BLOCKED_URL" else str(exc), exc.code) from exc
    except ImageError as exc:
        raise MixError(str(exc), exc.code) from exc
    hybrid = HybridImage(
        field_name=side,
        filename=f"{side}.png",
        content_type=content_type,
        data=png,
        source_url=final_url,
    )
    return normalize_image_for_provider(hybrid)


def _clean_trait(value: str, max_len: int) -> str:
    text = sanitize_parent_text(value, max_len)
    text = INJECTION_RE.sub("", text)
    text = re.sub(r"https?://\S+", "", text)
    text = re.sub(r"\$[A-Za-z0-9_]+", "", text)
    return re.sub(r"\s+", " ", text).strip() or "one original character"


def _hmac_secret() -> bytes:
    """
    FONS_JOB_HMAC is the current name; the other two are kept so an existing
    deployment does not lose its avatar jobs on a rename. Env var names are
    case sensitive, so this looks for the exact spellings only.
    """
    for name in ("FONS_JOB_HMAC", "MIXBORN_JOB_HMAC", "JOB_TOKEN_HMAC_SECRET"):
        raw = os.getenv(name, "").strip()
        if raw:
            return raw.encode("utf-8")
    return b""


def _token_body(payload: dict[str, Any]) -> bytes:
    return json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")


def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _unb64(raw: str) -> bytes:
    padding = "=" * (-len(raw) % 4)
    return base64.urlsafe_b64decode(raw + padding)


def _public_status(status: str, *, code: str | None = None, message: str | None = None) -> dict[str, Any]:
    payload: dict[str, Any] = {"status": status}
    if code:
        payload["code"] = code
    if message:
        payload["message"] = message
    elif status == "failed":
        payload["message"] = "This combination could not be rendered. Edit the concept or upload an image."
        payload.setdefault("code", "IMAGE_REJECTED")
    elif status == "expired":
        payload["message"] = "That avatar job has expired."
        payload["code"] = "JOB_EXPIRED"
    return payload


def _finish_job(job_id: str, status: str) -> None:
    cached = _RESULTS.get(job_id) or {}
    cached["status"] = status
    _RESULTS[job_id] = cached
    _clear_inflight_for(job_id)


def _clear_job(job_id: str) -> None:
    _RESULTS.pop(job_id, None)
    _clear_inflight_for(job_id)


def _clear_inflight_for(job_id: str) -> None:
    for ip, (stored, _) in list(_INFLIGHT.items()):
        if stored == job_id:
            _INFLIGHT.pop(ip, None)


def _purge(now: float) -> None:
    expired = [job_id for job_id, item in _RESULTS.items() if float(item.get("expires_at") or 0) < now]
    for job_id in expired:
        _RESULTS.pop(job_id, None)
        _clear_inflight_for(job_id)
    stale_nonces = [nonce for nonce, stamp in _SEEN_NONCES.items() if now - stamp > JOB_TTL_SECONDS]
    for nonce in stale_nonces:
        _SEEN_NONCES.pop(nonce, None)
