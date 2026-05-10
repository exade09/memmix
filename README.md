# Axiom AI Scanner

CLI scanner for finding currently hyped on-chain tokens using public market data.

Important: this tool ranks tokens by liquidity, volume, transactions, price momentum,
age, boosts, and risk flags. It does not guarantee profit and should not be treated
as financial advice.

## Why DexScreener first

Axiom is a trading terminal, but it does not expose a stable official public API for
all live token data. This project keeps data sources behind adapters, so the first
version uses DexScreener public endpoints and can later be extended with Mobula or
another provider that mirrors Axiom-like market data.

## Project structure

```text
axiom_ai_scanner/
  main.py                         # CLI entry point
  config.example.json             # Example scanner settings
  .env.example                    # Optional environment variables
  axiom_scanner/
    config.py                     # Config loading and defaults
    http_client.py                # Small HTTP client with retries
    models.py                     # Shared data models
    reporting.py                  # Console and JSON output
    analysis/
      scoring.py                  # Hype/opportunity/risk scoring
      local_ai.py                 # Local AI-like explanation layer
    sources/
      base.py                     # Source interface
      dexscreener.py              # DexScreener source adapter
  tests/
    test_scoring.py               # Basic scoring tests
```

## Quick start

```powershell
cd axiom_ai_scanner
python main.py scan --limit 15
```

Visual dashboard:

```powershell
python main.py web --port 8080 --limit 100
```

Then open:

```text
http://127.0.0.1:8080
```

The dashboard shows token images when the market data provider returns them.
Tokens are grouped by signal:

- `HOT`: strongest current metrics with no active risk flags.
- `WATCH`: good metrics, but not as clean or strong as HOT.
- `POTENTIAL`: weaker but still interesting candidates for manual review.
- `SPECULATIVE`: low-confidence ideas with higher risk or weaker data.

Watch mode:

```powershell
python main.py watch --interval 60 --limit 10
```

JSON output:

```powershell
python main.py scan --format json --limit 20
```

Run tests:

```powershell
python -m unittest discover -s tests
```

## Config

Copy `config.example.json` to `config.json` and adjust thresholds:

```powershell
Copy-Item config.example.json config.json
python main.py scan --config config.json
```

Useful fields:

- `chains`: chain IDs to scan, for example `solana`, `bsc`, `ethereum`.
- `min_liquidity_usd`: filters very thin pairs.
- `max_token_age_hours`: focuses on fresh launches.
- `source.search_terms`: extra DexScreener search terms used to find more potential tokens.
- `risk.max_sell_pressure`: flags tokens where sells dominate buys.
- `scoring`: weights for the ranking formula.

## Notes

- Prefer manual review before any trade.
- Very new tokens can be manipulated heavily.
- Low-liquidity pairs can show attractive percentage moves while being hard to exit.
- Paid boosts and social links are hype signals, not proof of quality.
