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
    a_sym = normalize_ticker(parent_a.get("symbol") or a_core) or "TKA"
    b_sym = normalize_ticker(parent_b.get("symbol") or b_core) or "TKB"
    a_prop = _signature(parent_a)
    b_prop = _signature(parent_b)
    names = [
        _clip(_portmanteau(a_core, b_core), 32),
        _clip(_portmanteau(b_core, a_core), 32),
        _clip(_portmanteau(a_core, b_core, head_ratio=0.35), 32),
    ]
    hooks = [
        f"A {a_core} character defined by {b_prop.lower()}.",
        f"{a_core} doing the typical {b_core} move.",
        f"One new mascot stuck in a {a_core} plus {b_core} situation.",
    ]
    strategies = [STRATEGIES[0], STRATEGIES[1], STRATEGIES[3]]
    tickers = _unique_tickers(
        [
            _ticker_blend(a_core, b_sym),
            _ticker_blend(b_core, a_sym),
            _ticker_blend(a_sym, b_sym),
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


def _portmanteau(head_word: str, tail_word: str, *, head_ratio: float = 0.55) -> str:
    """Blend two words into one coined word, the way a real ticker or brand name is coined."""
    head_alpha = "".join(ch for ch in head_word if ch.isalpha())
    tail_alpha = "".join(ch for ch in tail_word if ch.isalpha())
    if not head_alpha or not tail_alpha:
        return (head_alpha or head_word) + (tail_alpha or tail_word)
    head_lower, tail_lower = head_alpha.lower(), tail_alpha.lower()
    max_overlap = min(4, len(head_lower), len(tail_lower))
    for overlap in range(max_overlap, 1, -1):
        if head_lower[-overlap:] == tail_lower[:overlap]:
            return head_alpha[: len(head_alpha) - overlap] + tail_alpha
    head_cut = len(head_alpha) if len(head_alpha) <= 2 else max(2, min(len(head_alpha) - 1, round(len(head_alpha) * head_ratio)))
    tail_keep = min(len(tail_alpha), max(2, round(len(tail_alpha) * (1 - head_ratio))))
    return head_alpha[:head_cut] + tail_alpha[-tail_keep:]


def _ticker_blend(left: str, right: str) -> str:
    """Splice the head of one identifier onto the tail of another, like a real coined ticker."""
    left_clean = normalize_ticker(left) or "TK"
    right_clean = normalize_ticker(right) or "MX"
    head = left_clean[: min(3, len(left_clean))]
    room = max(1, 6 - len(head))
    tail = right_clean[-room:] if len(right_clean) > room else right_clean
    return normalize_ticker(head + tail)[:6] or "MIX"


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
