from __future__ import annotations

import uuid
from typing import Any


def new_request_id() -> str:
    return uuid.uuid4().hex


def envelope(
    *,
    success: bool,
    data: Any = None,
    code: str | None = None,
    message: str | None = None,
    request_id: str | None = None,
) -> dict[str, Any]:
    return {
        "success": success,
        "data": data,
        "error": None if success else {"code": code or "INVALID_INPUT", "message": message or "Request failed."},
        "request_id": request_id or new_request_id(),
    }
