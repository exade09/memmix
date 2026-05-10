from __future__ import annotations

import unittest

from axiom_scanner.analysis.scoring import rank_tokens
from axiom_scanner.config import ScannerConfig
from axiom_scanner.models import TokenSnapshot


class ScoringTests(unittest.TestCase):
    def test_stronger_token_ranks_higher(self) -> None:
        config = ScannerConfig()
        weak = TokenSnapshot(
            source="test",
            chain_id="solana",
            token_address="weak",
            symbol="WEAK",
            name="Weak",
            liquidity_usd=20_000,
            volume_1h=2_000,
            txns_1h=15,
            price_change_1h=2,
            age_minutes=500,
        )
        strong = TokenSnapshot(
            source="test",
            chain_id="solana",
            token_address="strong",
            symbol="STRONG",
            name="Strong",
            liquidity_usd=120_000,
            volume_1h=160_000,
            txns_1h=260,
            buys_1h=170,
            sells_1h=90,
            price_change_5m=6,
            price_change_1h=42,
            price_change_6h=70,
            age_minutes=75,
            socials_count=3,
        )

        ranked = rank_tokens([weak, strong], config)

        self.assertEqual(ranked[0].snapshot.symbol, "STRONG")
        self.assertGreater(ranked[0].score, ranked[1].score)

    def test_sell_pressure_adds_risk_flag(self) -> None:
        config = ScannerConfig()
        token = TokenSnapshot(
            source="test",
            chain_id="solana",
            token_address="risk",
            symbol="RISK",
            name="Risk",
            liquidity_usd=60_000,
            volume_1h=80_000,
            txns_1h=120,
            buys_1h=20,
            sells_1h=80,
            price_change_1h=20,
            age_minutes=90,
        )

        ranked = rank_tokens([token], config)

        self.assertIn("sell_pressure", ranked[0].risk_flags)


if __name__ == "__main__":
    unittest.main()
