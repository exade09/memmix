from __future__ import annotations

import json
import os
from typing import Any, Protocol

from axiom_scanner.analysis.mix_fallback import build_fallback_concepts
from axiom_scanner.analysis.mix_schema import (
    CONCEPT_IDS,
    FALLBACK_NOTICE,
    MIX_JSON_SCHEMA,
    REPAIR_PROMPT_TEMPLATE,
    STRATEGIES,
    SYSTEM_PROMPT,
    USER_PROMPT_TEMPLATE,
)
from axiom_scanner.http_client import HttpClient, SourceError, SourceRateLimited, SourceTimeout
from axiom_scanner.security.fields import (
    DESCRIPTION_AI_MAX,
    DESCRIPTION_AI_MIN,
    HOOK_MAX,
    TRAIT_MAX,
    USER_HINT_MAX,
    VISUAL_PROMPT_MAX,
    FieldError,
    prohibited_reasons,
    require_description,
    require_name,
    require_ticker,
    sanitize_parent_text,
)
from axiom_scanner.security.query import BASE58_RE, QueryError, safe_image_url


OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses"


class MixError(QueryError):
    pass


class JsonPoster(Protocol):
    def post_json(self, url: str, payload: dict[str, Any], *, headers: dict[str, str] | None = None) -> Any: ...


class MixValidationError(ValueError):
    def __init__(self, errors: list[str]) -> None:
        super().__init__("; ".join(errors))
        self.errors = errors


def mix_concepts(
    parent_a: dict[str, Any],
    parent_b: dict[str, Any],
    *,
    user_hint: str = "",
    http: JsonPoster | None = None,
) -> dict[str, Any]:
    a = _sanitize_parent(parent_a, "Parent A")
    b = _sanitize_parent(parent_b, "Parent B")
    if a["mint"].lower() == b["mint"].lower():
        raise MixError("Parents must be different.", "DUPLICATE_PARENTS")
    hint = sanitize_parent_text(user_hint, USER_HINT_MAX)

    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    model = os.getenv("OPENAI_RESPONSES_MODEL", "").strip()
    if not api_key or not model:
        return _fallback_payload(a, b, hint, reason="unconfigured")

    client = http or HttpClient(timeout_seconds=_timeout_seconds(), retries=0)
    try:
        parsed = _complete(client, api_key, model, a, b, hint, repair_errors=None)
        return _public_payload(a, b, parsed, source="openai", fallback=False)
    except MixValidationError as exc:
        try:
            parsed = _complete(client, api_key, model, a, b, hint, repair_errors=exc.errors)
            return _public_payload(a, b, parsed, source="openai", fallback=False, repaired=True)
        except (MixValidationError, SourceError, json.JSONDecodeError) as repair_exc:
            if isinstance(repair_exc, SourceRateLimited):
                raise MixError("The lab needs a short cooldown. Try again in a moment.", "RATE_LIMITED") from repair_exc
            raise MixError(
                "The mutation came back unstable. We are rebuilding the text.",
                "AI_OUTPUT_INVALID",
            ) from repair_exc
    except SourceRateLimited as exc:
        raise MixError("The lab needs a short cooldown. Try again in a moment.", "RATE_LIMITED") from exc
    except (SourceTimeout, SourceError, json.JSONDecodeError):
        return _fallback_payload(a, b, hint, reason="unavailable")


def _complete(
    client: JsonPoster,
    api_key: str,
    model: str,
    parent_a: dict[str, str],
    parent_b: dict[str, str],
    hint: str,
    repair_errors: list[str] | None,
) -> dict[str, Any]:
    user_prompt = USER_PROMPT_TEMPLATE.format(
        parent_a=_render_untrusted(parent_a),
        parent_b=_render_untrusted(parent_b),
        user_hint=hint or "[none]",
    )
    if repair_errors:
        user_prompt += "\n\n" + REPAIR_PROMPT_TEMPLATE.format(errors="\n".join(f"- {item}" for item in repair_errors))
    response = client.post_json(
        OPENAI_RESPONSES_URL,
        {
            "model": model,
            "store": False,
            "input": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            "text": {
                "format": {
                    "type": "json_schema",
                    "name": "mixborn_mix_concepts",
                    "strict": True,
                    "schema": MIX_JSON_SCHEMA,
                }
            },
        },
        headers={"Authorization": f"Bearer {api_key}"},
    )
    parsed = _extract_parsed(response)
    return validate_mix_payload(parsed, parent_a["mint"], parent_b["mint"])


def validate_mix_payload(raw: object, a_mint: str, b_mint: str) -> dict[str, Any]:
    errors: list[str] = []
    if not isinstance(raw, dict):
        raise MixValidationError(["Response is not a JSON object."])
    extra = set(raw) - {"parents", "concepts", "safety"}
    if extra:
        errors.append("unknown fields: " + ", ".join(sorted(extra)))
    safety = raw.get("safety") if isinstance(raw.get("safety"), dict) else {}
    if safety.get("contains_financial_claim") or safety.get("contains_disallowed_content"):
        errors.append("prohibited content flagged by model")
    concepts = raw.get("concepts")
    if not isinstance(concepts, list) or len(concepts) != 3:
        errors.append("expected exactly three concepts")
        raise MixValidationError(errors)
    ids: list[str] = []
    tickers: list[str] = []
    recommended = 0
    cleaned: list[dict[str, object]] = []
    for item in concepts:
        try:
            concept = _validate_concept(item)
        except MixValidationError as exc:
            errors.extend(exc.errors)
            continue
        ids.append(str(concept["id"]))
        tickers.append(str(concept["ticker"]))
        if concept["recommended"]:
            recommended += 1
        cleaned.append(concept)
    if ids != list(CONCEPT_IDS):
        errors.append("concept ids must be c1, c2, c3")
    if len(set(tickers)) != len(tickers):
        errors.append("duplicate tickers")
    if recommended == 0:
        errors.append("missing recommended")
    if recommended > 1:
        errors.append("multiple recommended")
    if errors:
        raise MixValidationError(errors)
    return {
        "parents": {"a_mint": a_mint, "b_mint": b_mint},
        "concepts": cleaned,
        "safety": {
            "contains_financial_claim": False,
            "contains_disallowed_content": False,
        },
    }


def _validate_concept(item: object) -> dict[str, object]:
    if not isinstance(item, dict):
        raise MixValidationError(["concept is not an object"])
    extra = set(item) - set(CONCEPT_SCHEMA_KEYS)
    errors: list[str] = []
    if extra:
        errors.append("unknown concept fields: " + ", ".join(sorted(extra)))
    try:
        name = require_name(item.get("name"))
        ticker = require_ticker(item.get("ticker"))
        description = require_description(
            item.get("description"),
            min_len=DESCRIPTION_AI_MIN,
            max_len=DESCRIPTION_AI_MAX,
        )
    except FieldError as exc:
        errors.append(str(exc))
        raise MixValidationError(errors) from exc
    strategy = str(item.get("strategy") or "")
    if strategy not in STRATEGIES:
        errors.append("invalid strategy")
    concept_id = str(item.get("id") or "")
    if concept_id not in CONCEPT_IDS:
        errors.append("invalid concept id")
    blob = " ".join(
        [
            name,
            ticker,
            description,
            str(item.get("character_hook") or ""),
            str(item.get("visual_prompt") or ""),
        ]
    )
    reasons = prohibited_reasons(blob)
    if reasons:
        errors.append("prohibited content: " + ", ".join(reasons))
    if errors:
        raise MixValidationError(errors)
    recommended = item.get("recommended")
    if not isinstance(recommended, bool):
        raise MixValidationError(["recommended must be boolean"])
    return {
        "id": concept_id,
        "name": name,
        "ticker": ticker,
        "description": description,
        "character_hook": sanitize_parent_text(item.get("character_hook"), HOOK_MAX),
        "strategy": strategy,
        "parent_a_trait": sanitize_parent_text(item.get("parent_a_trait"), TRAIT_MAX),
        "parent_b_trait": sanitize_parent_text(item.get("parent_b_trait"), TRAIT_MAX),
        "visual_prompt": sanitize_parent_text(item.get("visual_prompt"), VISUAL_PROMPT_MAX),
        "recommended": recommended,
    }


CONCEPT_SCHEMA_KEYS = {
    "id",
    "name",
    "ticker",
    "description",
    "character_hook",
    "strategy",
    "parent_a_trait",
    "parent_b_trait",
    "visual_prompt",
    "recommended",
}


def _public_payload(
    parent_a: dict[str, str],
    parent_b: dict[str, str],
    parsed: dict[str, Any],
    *,
    source: str,
    fallback: bool,
    repaired: bool = False,
) -> dict[str, Any]:
    public_concepts = []
    for concept in parsed["concepts"]:
        public_concepts.append(
            {
                "id": concept["id"],
                "name": concept["name"],
                "ticker": concept["ticker"],
                "description": concept["description"],
                "avatar_ready": True,
                "hook": concept["character_hook"],
                "recommended": concept["recommended"],
                "internal": {
                    "character_hook": concept["character_hook"],
                    "strategy": concept["strategy"],
                    "parent_a_trait": concept["parent_a_trait"],
                    "parent_b_trait": concept["parent_b_trait"],
                    "visual_prompt": concept["visual_prompt"],
                },
            }
        )
    return {
        "parents": {"a_mint": parent_a["mint"], "b_mint": parent_b["mint"]},
        "concepts": public_concepts,
        "source": source,
        "fallback": fallback,
        "fallback_notice": FALLBACK_NOTICE if fallback else None,
        "repaired": repaired,
    }


def _fallback_payload(parent_a: dict[str, str], parent_b: dict[str, str], hint: str, *, reason: str) -> dict[str, Any]:
    del hint, reason
    parsed = {
        "parents": {"a_mint": parent_a["mint"], "b_mint": parent_b["mint"]},
        "concepts": build_fallback_concepts(parent_a, parent_b),
        "safety": {"contains_financial_claim": False, "contains_disallowed_content": False},
    }
    return _public_payload(parent_a, parent_b, parsed, source="fallback", fallback=True)


def _sanitize_parent(raw: object, label: str) -> dict[str, str]:
    if not isinstance(raw, dict):
        raise MixError(f"{label} is required.", "INVALID_INPUT")
    mint = str(raw.get("mint") or "").strip()
    if not BASE58_RE.fullmatch(mint):
        raise MixError(f"{label} mint is not valid.", "INVALID_MINT")
    name = sanitize_parent_text(raw.get("name") or raw.get("symbol") or mint, 32)
    symbol = sanitize_parent_text(raw.get("symbol") or name, 12)
    description = sanitize_parent_text(raw.get("description") or "", 240)
    image = safe_image_url(raw.get("image_url") or "")
    observation = "has a square token avatar" if image else "no reference image"
    return {
        "mint": mint,
        "name": name or "Unknown",
        "symbol": symbol or "UNK",
        "description": description,
        "image_url": image,
        "visual_observation": observation,
    }


def _render_untrusted(parent: dict[str, str]) -> str:
    return (
        "UNTRUSTED_PARENT_BEGIN\n"
        f"mint={parent['mint']}\n"
        f"name={parent['name']}\n"
        f"symbol={parent['symbol']}\n"
        f"description={parent['description']}\n"
        f"visual_observation={parent['visual_observation']}\n"
        "UNTRUSTED_PARENT_END"
    )


def _extract_parsed(response: object) -> Any:
    if not isinstance(response, dict):
        raise MixValidationError(["provider response is not an object"])
    if isinstance(response.get("output_parsed"), dict):
        return response["output_parsed"]
    chunks: list[str] = []
    if isinstance(response.get("output_text"), str) and response["output_text"].strip():
        chunks.append(response["output_text"])
    for item in response.get("output") or []:
        if not isinstance(item, dict):
            continue
        for content in item.get("content") or []:
            if isinstance(content, dict) and content.get("type") in {"output_text", "text"}:
                chunks.append(str(content.get("text") or ""))
    if not chunks:
        raise MixValidationError(["malformed JSON"])
    try:
        return json.loads("".join(chunks))
    except json.JSONDecodeError as exc:
        raise MixValidationError(["malformed JSON"]) from exc


def _timeout_seconds() -> int:
    try:
        return max(8, min(int(os.getenv("OPENAI_MIX_TIMEOUT_SECONDS", "25")), 45))
    except ValueError:
        return 25
