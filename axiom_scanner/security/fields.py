from __future__ import annotations

import ipaddress
import os
import re
from decimal import Decimal, InvalidOperation
from urllib.parse import urlparse

from axiom_scanner.security.query import BASE58_RE, QueryError, sanitize_untrusted

NAME_MIN = 2
NAME_MAX = 32
TICKER_MIN = 1
TICKER_MAX = 6
TICKER_RE = re.compile(r"^[A-Z0-9]{1,6}$")
DESCRIPTION_LAUNCH_MIN = 1
DESCRIPTION_LAUNCH_MAX = 500
DESCRIPTION_AI_MIN = 40
DESCRIPTION_AI_MAX = 240
USER_HINT_MAX = 160
HOOK_MAX = 120
TRAIT_MAX = 160
VISUAL_PROMPT_MAX = 400
SOCIAL_URL_MAX = 200
WEBSITE_URL_MAX = 200
INITIAL_BUY_MAX_DEFAULT = Decimal("5")
INITIAL_BUY_DECIMALS = 9
TWITTER_HOSTS = {"x.com", "www.x.com", "twitter.com", "www.twitter.com"}
TELEGRAM_HOSTS = {"t.me", "www.t.me", "telegram.me", "www.telegram.me"}
BLOCKED_URL_HOSTS = {"localhost", "localhost.localdomain", "metadata.google.internal"}

INJECTION_RE = re.compile(
    r"(ignore (all )?(previous|prior|above) instructions|system prompt|you are now|"
    r"disregard (your|the) (rules|instructions)|reveal (your )?(system|hidden) prompt)",
    re.IGNORECASE,
)

PROFIT_RE = re.compile(
    r"\b(profit|guaranteed returns?|financial advice|investment advice|100x|1000x|"
    r"moonshot|get rich|will pump|guaranteed (value|liquidity)|price prediction)\b",
    re.IGNORECASE,
)
MANIPULATION_RE = re.compile(
    r"\b(wash trade|pump and dump|manipulate (the )?market|spoof(ing)? orders?|"
    r"insider (trading|info))\b",
    re.IGNORECASE,
)
DISALLOWED_RE = re.compile(
    r"\b(child sexual|csam|gore|beheading|rape|kill yourself|slur)\b",
    re.IGNORECASE,
)


class FieldError(QueryError):
    pass


def normalize_ticker(value: object) -> str:
    text = re.sub(r"[^A-Za-z0-9]", "", str(value or "")).upper()
    return text[:TICKER_MAX]


def is_valid_ticker(value: object) -> bool:
    return bool(TICKER_RE.fullmatch(normalize_ticker(value)))


def is_valid_name(value: object) -> bool:
    trimmed = str(value or "").strip()
    return NAME_MIN <= len(trimmed) <= NAME_MAX


def is_valid_description(value: object, *, min_len: int = DESCRIPTION_LAUNCH_MIN, max_len: int = DESCRIPTION_LAUNCH_MAX) -> bool:
    trimmed = str(value or "").strip()
    return min_len <= len(trimmed) <= max_len


def require_name(value: object) -> str:
    text = sanitize_untrusted(value, NAME_MAX)
    if not is_valid_name(text):
        raise FieldError("Name must be 2–32 characters.")
    return text


def require_ticker(value: object) -> str:
    ticker = normalize_ticker(value)
    if not TICKER_RE.fullmatch(ticker):
        raise FieldError("Ticker must be 1–6 uppercase letters or numbers.")
    return ticker


def require_description(
    value: object,
    *,
    min_len: int = DESCRIPTION_LAUNCH_MIN,
    max_len: int = DESCRIPTION_LAUNCH_MAX,
) -> str:
    text = sanitize_untrusted(value, max_len)
    if not is_valid_description(text, min_len=min_len, max_len=max_len):
        raise FieldError(f"Description must be {min_len}–{max_len} characters.")
    return text


def initial_buy_max_sol() -> Decimal:
    raw = os.getenv("INITIAL_BUY_MAX_SOL", str(INITIAL_BUY_MAX_DEFAULT))
    try:
        cap = Decimal(str(raw))
    except (InvalidOperation, ValueError):
        return INITIAL_BUY_MAX_DEFAULT
    if cap <= 0:
        return INITIAL_BUY_MAX_DEFAULT
    return cap


def require_initial_buy(value: object, *, max_sol: Decimal | None = None) -> str:
    text = str(value if value is not None else "0").strip() or "0"
    if not re.fullmatch(rf"\d+(\.\d{{1,{INITIAL_BUY_DECIMALS}}})?", text):
        raise FieldError("Initial buy must be a SOL amount.")
    try:
        amount = Decimal(text)
    except (InvalidOperation, ValueError) as exc:
        raise FieldError("Initial buy must be a SOL amount.") from exc
    if amount < 0:
        raise FieldError("Initial buy cannot be negative.")
    cap = max_sol if max_sol is not None else initial_buy_max_sol()
    if amount > cap:
        raise FieldError(f"Initial buy cannot exceed {cap} SOL.")
    if amount == 0:
        return "0"
    formatted = format(amount, "f")
    if "." in formatted:
        formatted = formatted.rstrip("0").rstrip(".")
    return formatted or "0"


def require_optional_twitter(value: object) -> str:
    return _require_optional_https(value, kind="twitter")


def require_optional_telegram(value: object) -> str:
    return _require_optional_https(value, kind="telegram")


def require_optional_website(value: object) -> str:
    return _require_optional_https(value, kind="website")


def require_optional_mint(value: object) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    if not BASE58_RE.fullmatch(text):
        raise FieldError("That mint address is not valid.", "INVALID_MINT")
    return text


def require_confirmed(value: object, *, label: str) -> bool:
    text = str(value or "").strip().lower()
    if text in {"1", "true", "yes", "on"}:
        return True
    raise FieldError(f"{label} confirmation is required.")


def _require_optional_https(value: object, *, kind: str) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    if len(text) > SOCIAL_URL_MAX:
        raise FieldError("That link is too long.")
    parsed = urlparse(text)
    if parsed.scheme != "https":
        raise FieldError("Links must use https.")
    if parsed.username or parsed.password:
        raise FieldError("Links may not include credentials.")
    host = (parsed.hostname or "").strip().lower().strip("[]")
    if not host:
        raise FieldError("That link is missing a host.")
    if host in BLOCKED_URL_HOSTS or host.endswith(".localhost") or host.endswith(".internal") or host.endswith(".local"):
        raise FieldError("That link host is not allowed.")
    if host == "0.0.0.0" or host.startswith("127."):
        raise FieldError("That link host is not allowed.")
    try:
        literal = ipaddress.ip_address(host)
    except ValueError:
        literal = None
    if literal is not None and (literal.is_private or literal.is_loopback or literal.is_link_local or literal.is_multicast):
        raise FieldError("That link host is not allowed.")
    if kind == "twitter":
        if host not in TWITTER_HOSTS:
            raise FieldError("X link must be an https x.com or twitter.com URL.")
        path = (parsed.path or "").strip("/")
        if not path:
            raise FieldError("X link must include a profile path.")
    elif kind == "telegram":
        if host not in TELEGRAM_HOSTS:
            raise FieldError("Telegram link must be an https t.me or telegram.me URL.")
        path = (parsed.path or "").strip("/")
        if not path:
            raise FieldError("Telegram link must include a channel or username.")
    elif kind == "website":
        if literal is None and "." not in host:
            raise FieldError("Website must be a public https URL.")
        if parsed.scheme != "https":
            raise FieldError("Website must be a public https URL.")
    return text


def sanitize_parent_text(value: object, max_len: int) -> str:
    text = sanitize_untrusted(value, max_len)
    text = INJECTION_RE.sub("[removed]", text)
    return text.strip()


def prohibited_reasons(text: str) -> list[str]:
    reasons: list[str] = []
    if PROFIT_RE.search(text):
        reasons.append("financial_claim")
    if MANIPULATION_RE.search(text):
        reasons.append("market_manipulation")
    if DISALLOWED_RE.search(text):
        reasons.append("disallowed_content")
    return reasons
