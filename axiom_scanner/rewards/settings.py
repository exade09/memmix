from __future__ import annotations

"""
The rewards settings that used to be environment variables.

Everything here decides how a payout is computed or where it is claimed from,
and all of it is set once, right after $FONS launches -- which is exactly the
moment when going back to a dashboard, editing a variable and waiting for a
redeploy is most annoying and most error-prone. So it lives in a file the
admin page writes instead.

Environment variables still work and are the fallback, so nothing that was
already configured stops working. A value set here wins, because the whole
point is that the panel is where you set it; leaving a field blank hands the
question back to the environment.

Reading is deliberately cheap and never throws: a missing or corrupt file
means "nothing is configured", which is the same answer an unset variable
gives, and it is the answer that keeps payouts refusing to run rather than
running on a guess.
"""

import json
import re
from pathlib import Path
from typing import Any

PROJECT_ROOT = Path(__file__).resolve().parents[2]
SETTINGS_FILE = PROJECT_ROOT / "data" / "settings.json"

ADDRESS_RE = re.compile(r"^0x[a-fA-F0-9]{40}$")

# The factory's own ceiling. A fee above this would be rejected on chain
# anyway, so it is refused here where the message can explain itself.
MAX_CREATOR_FEE_BPS = 1000


class SettingsError(ValueError):
    def __init__(self, message: str, code: str = "INVALID_INPUT") -> None:
        super().__init__(message)
        self.code = code


FIELDS = (
    "fons_token_address",
    "fons_token_start_block",
    "rewards_distributor_address",
    "rewards_vault_address",
    "creator_fee_bps",
)


def read_settings() -> dict[str, Any]:
    """Whatever is stored, with unknown keys dropped. Never raises."""
    try:
        raw = json.loads(SETTINGS_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    if not isinstance(raw, dict):
        return {}
    return {key: raw[key] for key in FIELDS if key in raw and raw[key] not in (None, "")}


def stored_address(key: str) -> str:
    value = str(read_settings().get(key) or "").strip()
    return value if ADDRESS_RE.match(value) else ""


def stored_int(key: str) -> int | None:
    raw = read_settings().get(key)
    if raw is None:
        return None
    try:
        return int(str(raw))
    except (TypeError, ValueError):
        return None


def validate(patch: dict[str, Any]) -> dict[str, Any]:
    """
    Check one submitted set of changes and return what should be stored.

    A field that arrives empty is a deletion, not a value: it clears the
    override and lets the environment answer again. That is the only way to
    undo a setting from the panel, so it has to be possible.
    """
    if not isinstance(patch, dict):
        raise SettingsError("Settings must be an object.")

    current = read_settings()
    result = dict(current)

    for key in FIELDS:
        if key not in patch:
            continue
        raw = patch[key]
        if raw is None or str(raw).strip() == "":
            result.pop(key, None)
            continue
        result[key] = _validate_one(key, raw)

    unknown = sorted(set(patch) - set(FIELDS) - {"password"})
    if unknown:
        raise SettingsError(f"Unknown setting: {unknown[0]}.")
    return result


def _validate_one(key: str, raw: Any) -> Any:
    if key.endswith("_address"):
        value = str(raw).strip()
        if not ADDRESS_RE.match(value):
            raise SettingsError(f"{_label(key)} must be a 0x address.")
        return value

    if key == "fons_token_start_block":
        try:
            value = int(str(raw).strip())
        except (TypeError, ValueError):
            raise SettingsError("Start block must be a whole number.") from None
        if value < 0:
            raise SettingsError("Start block cannot be negative.")
        return value

    if key == "creator_fee_bps":
        try:
            value = int(str(raw).strip())
        except (TypeError, ValueError):
            raise SettingsError("Creator fee must be a whole number of basis points.") from None
        if value < 0:
            raise SettingsError("Creator fee cannot be negative.")
        if value > MAX_CREATOR_FEE_BPS:
            raise SettingsError(
                f"Creator fee cannot exceed {MAX_CREATOR_FEE_BPS} bps "
                f"({MAX_CREATOR_FEE_BPS / 100:g}%), which is the factory's own ceiling."
            )
        return value

    raise SettingsError(f"Unknown setting: {key}.")


def _label(key: str) -> str:
    return key.replace("_", " ").replace("fons ", "$FONS ").capitalize()
