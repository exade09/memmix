from __future__ import annotations

import json
import os
from typing import Any

from axiom_scanner.security.fields import (
    require_description,
    require_initial_buy,
    require_name,
    require_optional_mint,
    require_optional_telegram,
    require_optional_twitter,
    require_optional_website,
    require_ticker,
)
from axiom_scanner.security.images import encode_launch_avatar
from axiom_scanner.storage.pinata import MetadataError, PinataPinner, Pinner, gateway_uri


def canonical_site_url() -> str:
    return (os.getenv("CANONICAL_SITE_URL") or os.getenv("MIXBORN_CANONICAL_URL") or "").strip()


def build_metadata_json(
    *,
    name: str,
    ticker: str,
    description: str,
    image_uri: str,
    twitter: str = "",
    telegram: str = "",
    website: str = "",
    generated: bool = False,
    parent_a_mint: str = "",
    parent_b_mint: str = "",
    created_on: str | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "name": name,
        "symbol": ticker,
        "description": description,
        "image": image_uri,
        "showName": True,
        "createdOn": created_on if created_on is not None else canonical_site_url(),
        "properties": {
            "category": "image",
            "files": [{"uri": image_uri, "type": "image/png"}],
        },
        "mixborn": {
            "generated": bool(generated),
            "version": 1,
        },
    }
    if twitter:
        payload["twitter"] = twitter
    if telegram:
        payload["telegram"] = telegram
    if website:
        payload["website"] = website
    mixborn = payload["mixborn"]
    if parent_a_mint:
        mixborn["parent_a_mint"] = parent_a_mint
    if parent_b_mint:
        mixborn["parent_b_mint"] = parent_b_mint
    return payload


def pin_launch_metadata(
    *,
    image_bytes: bytes,
    fields: dict[str, str],
    pinner: Pinner | None = None,
    gateway: str | None = None,
) -> dict[str, Any]:
    name = require_name(fields.get("name"))
    ticker = require_ticker(fields.get("ticker"))
    description = require_description(fields.get("description"))
    twitter = require_optional_twitter(fields.get("twitter"))
    telegram = require_optional_telegram(fields.get("telegram"))
    website = require_optional_website(fields.get("website"))
    require_initial_buy(fields.get("initial_buy_sol") or "0")
    parent_a = require_optional_mint(fields.get("parent_a_mint"))
    parent_b = require_optional_mint(fields.get("parent_b_mint"))
    generated = str(fields.get("generated") or "").strip().lower() in {"1", "true", "yes"}
    png, image_sha256 = encode_launch_avatar(image_bytes, "avatar")
    adapter = pinner or PinataPinner()
    image_cid = adapter.pin_file(png, "avatar.png", "image/png")
    image_uri = gateway_uri(image_cid, gateway)
    metadata = build_metadata_json(
        name=name,
        ticker=ticker,
        description=description,
        image_uri=image_uri,
        twitter=twitter,
        telegram=telegram,
        website=website,
        generated=generated,
        parent_a_mint=parent_a,
        parent_b_mint=parent_b,
    )
    for banned in ("prompt", "visual_prompt", "job_id", "job_token", "wallet", "signature", "score"):
        if banned in metadata or banned in metadata.get("mixborn", {}):
            raise MetadataError("Public metadata contained a private field.", "METADATA_PIN_FAILED")
    raw = json.dumps(metadata, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    metadata_cid = adapter.pin_file(raw, "metadata.json", "application/json")
    metadata_uri = gateway_uri(metadata_cid, gateway)
    return {
        "image_uri": image_uri,
        "image_cid": image_cid,
        "metadata_uri": metadata_uri,
        "metadata_cid": metadata_cid,
        "image_sha256": image_sha256,
        "name": name,
        "ticker": ticker,
    }
