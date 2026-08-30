from __future__ import annotations

from axiom_scanner.analysis.mix_schema import CONCEPT_IDS, STRATEGIES
from axiom_scanner.security.fields import (
    DESCRIPTION_AI_MAX,
    DESCRIPTION_AI_MIN,
    normalize_ticker,
    require_description,
    require_name,
    require_ticker,
)


def build_fallback_concepts(parent_a: dict[str, str], parent_b: dict[str, str]) -> list[dict[str, object]]:
    a_core = _core_word(parent_a)
    b_core = _core_word(parent_b)
    a_prop = _signature(parent_a)
    b_prop = _signature(parent_b)
    names = [
        _clip(f"{a_core} With {b_prop}", 32),
        _clip(f"{b_core} {a_core} Role", 32),
        _clip(f"The {a_core} {b_prop} Scene", 32),
    ]
    hooks = [
        f"A {a_core} character defined by {b_prop.lower()}.",
        f"{a_core} doing the typical {b_core} move.",
        f"One new mascot stuck in a {a_core} plus {b_core} situation.",
    ]
    strategies = [STRATEGIES[0], STRATEGIES[1], STRATEGIES[3]]
    tickers = _unique_tickers(
        [
            _ticker_bits(a_core, b_prop, "W"),
            _ticker_bits(b_core, a_core, "R"),
            _ticker_bits(a_core, b_core, "S"),
        ]
    )
    concepts: list[dict[str, object]] = []
    for index, concept_id in enumerate(CONCEPT_IDS):
        name = require_name(names[index])
        ticker = require_ticker(tickers[index])
        description = require_description(
            _description(name, a_core, b_core, a_prop, b_prop, index),
            min_len=DESCRIPTION_AI_MIN,
            max_len=DESCRIPTION_AI_MAX,
        )
        concepts.append(
            {
                "id": concept_id,
                "name": name,
                "ticker": ticker,
                "description": description,
                "character_hook": hooks[index][:120],
                "strategy": strategies[index],
                "parent_a_trait": a_prop,
                "parent_b_trait": b_prop,
                "visual_prompt": (
                    f"one centered {a_core.lower()} character wearing or holding {b_prop.lower()}, "
                    "square crop, no text, no dual logos"
                )[:400],
                "recommended": index == 0,
            }
        )
    return concepts


def _core_word(parent: dict[str, str]) -> str:
    name = str(parent.get("name") or parent.get("symbol") or "Meme").strip()
    token = "".join(ch for ch in name if ch.isalnum() or ch.isspace()).split()
    word = token[0] if token else "Meme"
    return word[:12].capitalize() or "Meme"


def _signature(parent: dict[str, str]) -> str:
    blob = f"{parent.get('name', '')} {parent.get('symbol', '')} {parent.get('description', '')}".lower()
    if any(word in blob for word in ("wif", "hat", "beanie")):
        return "Hat"
    if "bonk" in blob or "bat" in blob:
        return "Bat"
    if any(word in blob for word in ("pepe", "frog", "fwog")):
        return "Frog grin"
    if any(word in blob for word in ("cat", "mew", "popcat")):
        return "Cat stare"
    if any(word in blob for word in ("dog", "inu", "doge")):
        return "Dog energy"
    symbol = normalize_ticker(parent.get("symbol") or parent.get("name") or "MARK")
    return f"{symbol[:4].title()} mark"


def _description(name: str, a_core: str, b_core: str, a_prop: str, b_prop: str, index: int) -> str:
    lines = [
        f"{name} is a {a_core.lower()} mascot that borrowed {b_prop.lower()} from {b_core} and turned it into one readable joke, not a chart call.",
        f"{name} puts {a_core} in the {b_core} role so the new character acts first and looks second, still one silhouette.",
        f"{name} traps {a_core} and {b_core} in one scene with {a_prop.lower()} and {b_prop.lower()} as the only two inherited tells.",
    ]
    text = lines[index]
    if len(text) < DESCRIPTION_AI_MIN:
        text += " The avatar stays one character, square, and free of profit talk."
    return text[:DESCRIPTION_AI_MAX]


def _ticker_bits(left: str, right: str, salt: str) -> str:
    left_clean = normalize_ticker(left)
    right_clean = normalize_ticker(right)
    raw = (left_clean[:2] + salt + right_clean[:2]) or salt
    return normalize_ticker(raw)[:6]


def _unique_tickers(candidates: list[str]) -> list[str]:
    used: set[str] = set()
    result: list[str] = []
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ"
    for index, candidate in enumerate(candidates):
        ticker = normalize_ticker(candidate) or f"MIX{index + 1}"
        spin = 0
        while ticker in used or len(ticker) < 1:
            suffix = alphabet[spin % len(alphabet)]
            ticker = normalize_ticker((ticker[:5] or "MIX") + suffix)
            spin += 1
            if spin > 40:
                ticker = f"MX{index}{spin}"[:6]
                break
        used.add(ticker)
        result.append(ticker)
    return result


def _clip(value: str, limit: int) -> str:
    return value.strip()[:limit]
