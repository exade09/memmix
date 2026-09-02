# FONS

> Previously Axiom Meme Lab, then MIXBORN. Pick two existing tokens, let the AI mix their logic, launch the one that is born.
>
> [docs/MIXBORN_PRODUCT_IMPLEMENTATION_SPEC.md](docs/MIXBORN_PRODUCT_IMPLEMENTATION_SPEC.md) remains the product source of truth for the mixer, security and Definition of Done, but it predates two owner-directed changes: the rename to **FONS** and the migration from Solana/Pump to **Robinhood Chain** with **MetaMask**. On chain, wallet and naming, [AGENTS.md](AGENTS.md) is current. Coding agents should read it first.
>
> Tokens are launched through the public [Pons v2](https://docs.ponsfamily.com/v2) factory on Robinhood Chain. FONS charges no fee of its own; the 0.0005 ETH launch fee is Pons's, read live from the contract.
>
> FONS is not affiliated with, endorsed by, or a partner of Robinhood Markets or Pons. It builds on public contracts on the Robinhood Chain network.

The FONS web app lives in `web/` as a Vite + React + TypeScript client. The existing Python scanner API still serves `/api/*`.

Local FONS UI:

```powershell
python main.py web --port 8080 --limit 100
```

In a second terminal:

```powershell
cd web
npm install
npm run dev
```

Then open `http://127.0.0.1:5173`. Vite proxies `/api` to the Python server on port 8080.

### BORN, the mascot

BORN is drawn in code: `web/src/components/brand/BornMascot.tsx` renders him as SVG in a
`portrait` and a `full` variant, so he scales anywhere and reacts to real product state.
The black void where his face should be *is* the merge core — Parent A arrives as a copper
orb, Parent B as an ash orb, they collide, and the born mark appears.

To swap in the final hand-drawn art, drop two square-ish images here:

```text
web/public/assets/brand/born-portrait.png   # head and shoulders
web/public/assets/brand/born-full.png       # full body, roughly 340 x 546
```

They fade in over the SVG automatically everywhere he appears — hero, mixer, sidebar,
review and success. A missing file simply never loads and the SVG stays. Keep the light
paper background of the originals; the surrounding plate is designed for it.

The earlier mascot source is still at `web/src/assets/brand/mascot-source.png`.

CLI scanner and web dashboard for finding currently hyped on-chain tokens, then
mixing those trends with OG meme coins into draft meme narratives.

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
      narratives.py               # Meme narrative and visual remix briefs
      image_generation.py         # Optional OpenAI image generation bridge
      wavespeed_hybrid.py         # WaveSpeed two-image hybrid generator
    sources/
      base.py                     # Source interface
      dexscreener.py              # DexScreener source adapter
  tests/
    test_scoring.py               # Basic scoring tests
  web/
    index.html                    # Vite SPA entry
    src/                          # MIXBORN React/TypeScript UI
    public/                       # Brand assets served as static files
    dist/                         # Production build output
    assets/                       # Images and token icons
```

## Quick start

Install dependencies once:

```powershell
python -m pip install -r requirements.txt
```

The same commands work on Windows, macOS, and Linux as long as Python 3.10+
is installed.

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

## Deploy to Vercel

The repository is ready to deploy as a Vercel project from the repo root. Vercel
serves the dashboard from `web/` and routes the Python serverless API through
`api/index.py`.

Recommended Vercel settings:

- Framework Preset: Other
- Build Command: leave empty
- Output Directory: leave empty
- Install Command: leave default so `requirements.txt` is installed

Python runtime is pinned for Vercel with `.python-version` and
`pyproject.toml` to avoid implicit runtime selection during builds.

Optional environment variables:

- `OPENAI_API_KEY`: enables narrative card image generation.
- `WAVESPEED_API_KEY` or `WAVESPEED_API_KEYS`: enables Mixer Studio hybrid images.
- `WAVESPEED_TIMEOUT_SECONDS`: optional, defaults to `120`.
- `PINATA_JWT`: server-only Pinata JWT for metadata pinning. Never expose it to the browser.
- `PUBLIC_IPFS_GATEWAY` or `PINATA_GATEWAY_HOST`: HTTPS IPFS gateway used to render CIDs.
- `CANONICAL_SITE_URL`: `createdOn` value written into token metadata.
- `INITIAL_BUY_MAX_ETH`: optional launch form cap, defaults to `0.5`.
- `ROBINHOOD_RPC_URL`: read-only JSON-RPC endpoint proxied by `/api/chain/rpc`.
- `PONS_FACTORY_ADDRESS`: optional override for the Pons v2 launch factory. Defaults to the verified live deployment.
- `ENABLE_NATIVE_LAUNCH` / `ENABLE_MAINNET_LAUNCH`: both default to `true`. Set either to `false` to switch launching off.

If live DexScreener requests fail in a serverless function, `/api/scan` falls back
to a bundled meme dataset so the dashboard still renders. That dataset is
historical Solana reference data used by the narrative mixer; it is not the
live feed, which reads Robinhood Chain.

Vercel ignores the local CLI entrypoint `main.py`; production routes use the
single explicit Python entrypoint configured in `pyproject.toml`.

The dashboard shows token images when the market data provider returns them. It
also includes a Meme Lab panel that blends each trend token with an OG meme coin
and produces:

- a mixed meme name and ticker,
- a short narrative draft,
- a reference-based image remix brief,
- a Mixer Studio link for turning the two token images into one artwork,
- a generated image when `OPENAI_API_KEY` is set.

Tokens are grouped by signal:

- `HOT`: strongest current metrics with no active risk flags.
- `WATCH`: good metrics, but not as clean or strong as HOT.
- `POTENTIAL`: weaker but still interesting candidates for manual review.
- `SPECULATIVE`: looser-filter finds that need extra caution.

## Image generation

Mixer Studio uses WaveSpeed Seedream V4.5 Edit. Each narrative card has a
`Mixer studio` button that jumps to the studio section on the same `index.html`
page with the trend token image, OG token image, and prompt already filled in.
You can also scroll to the studio section and choose any two local images from
your computer.

Before upload, the backend normalizes images with Pillow into RGB PNG files.
This avoids common provider rejections caused by alpha channels, unusual image
metadata, tiny inputs, or unsupported local formats.

If Seedream V4.5 Edit rejects a specific image or prompt, the backend retries
with a safer prompt on Seedream V4.5 Edit and then falls back to Seedream V4 Edit.

Set a WaveSpeed API key before starting the web server:

```powershell
Set-Content .env "WAVESPEED_API_KEY=your-key"
python main.py web --port 8080 --limit 100
```

For fallback across multiple WaveSpeed accounts, use a comma-separated list:

```powershell
Set-Content .env "WAVESPEED_API_KEYS=first-key,second-key"
python main.py web --port 8080 --limit 100
```

Optional settings:

```powershell
$env:WAVESPEED_IMAGE_SIZE="1024*1024"
$env:WAVESPEED_TIMEOUT_SECONDS="120"
$env:WAVESPEED_SYNC_MODE="true"
$env:WAVESPEED_POLL_INTERVAL_SECONDS="1.0"
```

Hybrid generation events are written to `logs/hybrid.log` without API keys.

Latency notes:

- the backend normalizes both inputs in parallel,
- both images upload to WaveSpeed in parallel,
- sync mode is enabled by default so completed results can come back directly,
- if polling is needed, the default interval is 1 second.

The image button uses the trend token image as the primary reference and the OG
meme image as a secondary remix reference. This is designed for cases like
keeping an `Aliens` mascot recognizable while adding an antivirus mask, floating
virus particles, or a changed background from another coin's theme.

Set an API key before starting the web server:

```powershell
Set-Content .env "OPENAI_API_KEY=sk-..."
python main.py web --port 8080 --limit 100
```

Optional settings:

```powershell
$env:OPENAI_RESPONSES_MODEL="gpt-5.5"
$env:OPENAI_IMAGE_SIZE="1024x1024"
$env:OPENAI_IMAGE_QUALITY="medium"
```

## Free hosting on Render

This repository includes `render.yaml`, `requirements.txt`, and `Procfile`.

Steps:

1. Push this project to GitHub.
2. Open `https://render.com`.
3. Create a new Web Service or Blueprint from the GitHub repository.
4. Choose the Free instance type.
5. Use this start command if Render asks for it:

```powershell
python main.py web --host 0.0.0.0 --limit 100
```

Render provides the public HTTPS URL after the first deploy.

## GitHub checklist

Before pushing:

```powershell
python -m pip install -r requirements.txt
python -m unittest discover -s tests
git status --short
```

Keep secrets in `.env` only. Commit `.env.example`, not `.env`.

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

- `chains`: chain IDs to scan. The default setup keeps this to `robinhood`.
- `min_liquidity_usd`: filters very thin pairs. Default is intentionally loose.
- `min_market_cap_usd`: keeps the visible set at or above the target market cap.
- `max_token_age_hours`: focuses on fresh launches.
- `og_memecoins_path`: JSON file used by the narrative mixer.
- `source.search_terms`: extra DexScreener search terms used to find more potential tokens.
- `risk.max_sell_pressure`: flags tokens where sells dominate buys.
- `scoring`: weights for the ranking formula.

## OG meme list

Edit `data/og_memecoins.json` or paste lines into the web panel:

```text
Dogecoin,DOGE,original dog money
Pepe,PEPE,frog meta and internet lore
Bonk,BONK,Solana dog energy
```

## Notes

- Prefer manual review before any trade.
- Very new tokens can be manipulated heavily.
- Low-liquidity pairs can show attractive percentage moves while being hard to exit.
- Paid boosts and social links are hype signals, not proof of quality.
