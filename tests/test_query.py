from __future__ import annotations

import unittest

from axiom_scanner.http_client import SourceMalformed, SourceRateLimited, SourceTimeout
from axiom_scanner.security.query import (
    QueryError,
    collision_warning,
    mint_from_url,
    parse_search_query,
    sanitize_untrusted,
    snapshot_to_summary,
)
from axiom_scanner.models import TokenSnapshot


class QueryParsingTests(unittest.TestCase):
    def test_raw_mint_is_returned_first(self) -> None:
        mint = "0x0000000000000000000000000000000000001111"
        query, exact = parse_search_query(mint)
        self.assertEqual(query, mint)
        self.assertEqual(exact, mint)

    def test_pump_url_extracts_mint(self) -> None:
        mint = "0x000000000000000000000000000000000000cccc"
        query, exact = parse_search_query(f"https://dexscreener.com/robinhood/{mint}")
        self.assertEqual(query, mint)
        self.assertEqual(exact, mint)

    def test_dexscreener_url_extracts_mint(self) -> None:
        mint = "0x0000000000000000000000000000000000001111"
        query, exact = parse_search_query(f"https://dexscreener.com/robinhood/{mint}")
        self.assertEqual(query, mint)
        self.assertEqual(exact, mint)

    def test_unknown_host_is_rejected(self) -> None:
        with self.assertRaises(ValueError):
            parse_search_query("https://example.com/coin/abc")

    def test_mint_from_url_ignores_other_hosts(self) -> None:
        self.assertIsNone(mint_from_url("https://evil.example/solana/0x0000000000000000000000000000000000001111"))

    def test_empty_search_is_rejected(self) -> None:
        with self.assertRaises(QueryError) as ctx:
            parse_search_query("  ")
        self.assertEqual(ctx.exception.code, "INVALID_INPUT")

    def test_invalid_mint_is_rejected(self) -> None:
        with self.assertRaises(QueryError) as ctx:
            parse_search_query("0x" + "a" * 39)
        self.assertEqual(ctx.exception.code, "INVALID_MINT")

    def test_short_query_without_mint_is_rejected(self) -> None:
        with self.assertRaises(QueryError):
            parse_search_query("x")

    def test_xss_like_token_content_is_stripped(self) -> None:
        snapshot = TokenSnapshot(
            source="test",
            chain_id="robinhood",
            token_address="0x0000000000000000000000000000000000001111",
            symbol="<script>alert(1)</script>WIF",
            name="<img src=x onerror=alert(1)>dogwifhat",
            liquidity_usd=120000,
            image_url="javascript:alert(1)",
        )
        summary = snapshot_to_summary(snapshot)
        self.assertNotIn("<", str(summary["name"]))
        self.assertNotIn("script", str(summary["symbol"]).lower())
        self.assertEqual(summary["image_url"], "")
        self.assertIn("dogwifhat", str(summary["name"]))

    def test_sanitize_untrusted_strips_tags(self) -> None:
        self.assertEqual(sanitize_untrusted("<b>BONK</b>"), "BONK")

    def test_exact_name_ticker_collision_warning(self) -> None:
        items = [
            {"mint": "0x000000000000000000000000000000000000aaaa", "name": "Wen", "symbol": "WEN"},
            {"mint": "0x000000000000000000000000000000000000bbbb", "name": "Wen Two", "symbol": "WEN"},
        ]
        warning = collision_warning(items, "WEN")
        self.assertIsNotNone(warning)
        self.assertIn("Mint is the identity", warning or "")

    def test_missing_metrics_stay_unknown(self) -> None:
        snapshot = TokenSnapshot(
            source="test",
            chain_id="robinhood",
            token_address="0x0000000000000000000000000000000000001111",
            symbol="NONE",
            name="None",
        )
        summary = snapshot_to_summary(snapshot)
        self.assertIsNone(summary["liquidity_usd"])
        self.assertIsNone(summary["volume_24h_usd"])
        self.assertIsNone(summary["price_change_1h"])


class FakeHttp:
    def __init__(self, payload=None, error: Exception | None = None) -> None:
        self.payload = payload
        self.error = error
        self.urls: list[str] = []

    def get_json(self, url: str):
        self.urls.append(url)
        if self.error:
            raise self.error
        return self.payload


class SearchRouteTests(unittest.TestCase):
    def test_timeout(self) -> None:
        from axiom_scanner.config import ScannerConfig
        from vercel_api.routes.search import search_tokens

        with self.assertRaises(SourceTimeout):
            search_tokens("bonk", 8, ScannerConfig(), http=FakeHttp(error=SourceTimeout("timeout")))

    def test_rate_limit(self) -> None:
        from axiom_scanner.config import ScannerConfig
        from vercel_api.routes.search import search_tokens

        with self.assertRaises(SourceRateLimited):
            search_tokens("bonk", 8, ScannerConfig(), http=FakeHttp(error=SourceRateLimited("rate limited")))

    def test_malformed_provider_response(self) -> None:
        from axiom_scanner.config import ScannerConfig
        from vercel_api.routes.search import search_tokens

        result = search_tokens("bonk", 8, ScannerConfig(), http=FakeHttp(payload="not-json"))
        self.assertEqual(result["items"], [])

    def test_empty_pairs(self) -> None:
        from axiom_scanner.config import ScannerConfig
        from vercel_api.routes.search import search_tokens

        result = search_tokens("bonk", 8, ScannerConfig(), http=FakeHttp(payload={"pairs": []}))
        self.assertEqual(result["items"], [])

    def test_robinhood_only_and_duplicate_token_keeps_highest_liquidity(self) -> None:
        from axiom_scanner.config import ScannerConfig
        from vercel_api.routes.search import search_tokens

        mint = "0x0000000000000000000000000000000000001111"
        payload = {
            "pairs": [
                _pair(mint, "Wrapped SOL", "SOL", liquidity=10, volume=1, chain="ethereum"),
                _pair(mint, "Wrapped SOL", "SOL", liquidity=50, volume=3),
                _pair(mint, "Wrapped SOL", "SOL", liquidity=80, volume=9),
            ]
        }
        result = search_tokens("SOL", 8, ScannerConfig(), http=FakeHttp(payload=payload))
        self.assertEqual(len(result["items"]), 1)
        self.assertEqual(result["items"][0]["liquidity_usd"], 80)


class DispatchTests(unittest.TestCase):
    def test_empty_search_returns_invalid_input(self) -> None:
        from vercel_api.dispatch import handle_api_get

        status, payload = handle_api_get("/api/search", {"q": [""]})
        self.assertEqual(status, 400)
        self.assertFalse(payload["success"])
        self.assertEqual(payload["error"]["code"], "INVALID_INPUT")

    def test_invalid_mint_returns_invalid_mint(self) -> None:
        from vercel_api.dispatch import handle_api_get

        status, payload = handle_api_get("/api/search", {"q": ["0x" + "a" * 39]})
        self.assertEqual(status, 400)
        self.assertEqual(payload["error"]["code"], "INVALID_MINT")

    def test_timeout_maps_source_unavailable(self) -> None:
        from unittest.mock import patch
        from vercel_api.dispatch import handle_api_get

        with patch("vercel_api.dispatch.search_tokens", side_effect=SourceTimeout("timeout")):
            status, payload = handle_api_get("/api/search", {"q": ["bonk"]})
        self.assertEqual(status, 504)
        self.assertEqual(payload["error"]["code"], "SOURCE_UNAVAILABLE")

    def test_rate_limit_maps_429(self) -> None:
        from unittest.mock import patch
        from vercel_api.dispatch import handle_api_get

        with patch("vercel_api.dispatch.search_tokens", side_effect=SourceRateLimited("rate limited")):
            status, payload = handle_api_get("/api/search", {"q": ["bonk"]})
        self.assertEqual(status, 429)
        self.assertEqual(payload["error"]["code"], "RATE_LIMITED")

    def test_malformed_is_empty_success(self) -> None:
        from unittest.mock import patch
        from vercel_api.dispatch import handle_api_get

        with patch("vercel_api.dispatch.search_tokens", return_value={"items": [], "collision_warning": None}):
            status, payload = handle_api_get("/api/search", {"q": ["bonk"]})
        self.assertEqual(status, 200)
        self.assertEqual(payload["data"]["items"], [])

    def test_token_invalid_mint(self) -> None:
        from vercel_api.dispatch import handle_api_get

        status, payload = handle_api_get("/api/token/not-a-mint", {})
        self.assertEqual(status, 400)
        self.assertEqual(payload["error"]["code"], "INVALID_MINT")


class FeedFallbackTests(unittest.TestCase):
    def test_bundled_fallback_has_no_fake_mint_or_metrics(self) -> None:
        from vercel_api.shared import fallback_scan_rows
        from axiom_scanner.security.query import scan_row_to_summary

        rows = fallback_scan_rows(3)
        self.assertGreater(len(rows), 0)
        for row in rows:
            self.assertEqual(row["address"], "")
            self.assertIsNone(row["liquidity_usd"])
            self.assertIsNone(row["volume_24h"])
            summary = scan_row_to_summary(row)
            self.assertEqual(summary["source"], "bundled")
            self.assertIsNone(summary["score"])

    def test_feed_filters_and_mixable(self) -> None:
        from unittest.mock import patch
        from vercel_api.routes.feed import feed_tokens

        payload = {
            "tokens": [
                {
                    "address": "0x000000000000000000000000000000000000aaaa",
                    "name": "Alpha",
                    "token": "AAA",
                    "image_url": "https://example.com/a.png",
                    "liquidity_usd": 5000,
                    "volume_24h": 8000,
                    "age_minutes": 30,
                    "score": 140,
                    "risk_flags": [],
                },
                {
                    "address": "0x000000000000000000000000000000000000bbbb",
                    "name": "Beta",
                    "token": "BBB",
                    "image_url": "",
                    "liquidity_usd": 200,
                    "volume_24h": 100,
                    "age_minutes": 400,
                    "score": 12,
                    "risk_flags": [],
                },
            ],
            "updated_at": "now",
            "data_source": "dexscreener",
            "fallback_error": "",
        }
        with patch("vercel_api.routes.feed.scan_payload", return_value=payload):
            mixable = feed_tokens("mixable", 24)
            filtered = feed_tokens("trending", 24, min_liquidity=1000, has_image=True)
        self.assertEqual(len(mixable["tokens"]), 1)
        self.assertEqual(mixable["tokens"][0]["symbol"], "AAA")
        self.assertEqual(mixable["tokens"][0]["score"], 100)
        self.assertEqual(len(filtered["tokens"]), 1)


class TokenRouteTests(unittest.TestCase):
    def test_missing_market_is_honest(self) -> None:
        from axiom_scanner.config import ScannerConfig
        from vercel_api.routes.token import token_detail

        mint = "0x0000000000000000000000000000000000001111"
        detail = token_detail(
            mint,
            ScannerConfig(),
            http=FakeHttp(payload=[]),
            rpc_post=lambda _body: {"result": "0x60806040"},  # contract code present
        )
        self.assertIsNone(detail["market"])
        self.assertIn("indexers", detail["notice"] or "")
        self.assertEqual(detail["onchain"]["creator"], None)
        self.assertTrue(detail["onchain"]["mint_exists"])

    def test_missing_account_is_not_found(self) -> None:
        from axiom_scanner.config import ScannerConfig
        from axiom_scanner.security.query import QueryError
        from vercel_api.routes.token import token_detail

        mint = "0x0000000000000000000000000000000000001111"
        with self.assertRaises(QueryError) as ctx:
            token_detail(
                mint,
                ScannerConfig(),
                http=FakeHttp(payload=[]),
                rpc_post=lambda _body: {"result": "0x"},  # nothing deployed here
            )
        self.assertEqual(ctx.exception.code, "TOKEN_NOT_FOUND")

    def test_account_without_code_is_not_treated_as_a_token(self) -> None:
        from axiom_scanner.config import ScannerConfig
        from axiom_scanner.security.query import QueryError
        from vercel_api.routes.token import token_detail

        mint = "0x0000000000000000000000000000000000000001"
        with self.assertRaises(QueryError) as ctx:
            token_detail(
                mint,
                ScannerConfig(),
                http=FakeHttp(payload=[]),
                # an externally owned account holds a balance but no code
                rpc_post=lambda _body: {"result": "0x"},
            )
        self.assertEqual(ctx.exception.code, "TOKEN_NOT_FOUND")

    def test_rpc_degraded_does_not_fake_missing_token(self) -> None:
        from axiom_scanner.config import ScannerConfig
        from vercel_api.routes.token import token_detail

        mint = "0x0000000000000000000000000000000000001111"

        def boom(_body):
            raise TimeoutError("rpc down")

        detail = token_detail(mint, ScannerConfig(), http=FakeHttp(payload=[]), rpc_post=boom)
        self.assertIsNone(detail["market"])
        self.assertIsNone(detail["onchain"]["mint_exists"])
        self.assertIn("delayed", detail["notice"] or "")

    def test_token_not_found_maps_404(self) -> None:
        from unittest.mock import patch
        from axiom_scanner.security.query import QueryError
        from vercel_api.dispatch import handle_api_get

        mint = "0x0000000000000000000000000000000000001111"
        with patch(
            "vercel_api.dispatch.token_detail",
            side_effect=QueryError("That mint was not found on-chain.", "TOKEN_NOT_FOUND"),
        ):
            status, payload = handle_api_get(f"/api/token/{mint}", {})
        self.assertEqual(status, 404)
        self.assertEqual(payload["error"]["code"], "TOKEN_NOT_FOUND")


def _pair(mint: str, name: str, symbol: str, liquidity: float, volume: float, chain: str = "robinhood") -> dict:
    return {
        "chainId": chain,
        "pairAddress": f"pair-{mint[-6:]}-{int(liquidity)}",
        "dexId": "pump",
        "url": f"https://dexscreener.com/robinhood/{mint}",
        "baseToken": {"address": mint, "name": name, "symbol": symbol},
        "liquidity": {"usd": liquidity},
        "volume": {"h24": volume},
        "priceChange": {"h1": 1.2},
        "info": {"imageUrl": "https://example.com/token.png"},
    }


if __name__ == "__main__":
    unittest.main()
