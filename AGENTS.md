# FONS — agent briefing

Read this file before changing the repo. It is the working brief for coding agents. The product specification remains the source of truth:

- Product / brand / launch / security / Definition of Done: [`docs/FONS_PRODUCT_IMPLEMENTATION_SPEC.md`](docs/FONS_PRODUCT_IMPLEMENTATION_SPEC.md)
- Reused UI licenses: [`docs/THIRD_PARTY_UI.md`](docs/THIRD_PARTY_UI.md)
- Human README: [`README.md`](README.md)

If implementation diverges from the specification, the specification wins — except confirmed protocol / security constraints and explicit owner instructions.

**The spec predates two owner-directed changes and is not authoritative on them.** The product was renamed MIXBORN → **FONS**, and the chain was migrated Solana/Pump → **Robinhood Chain** (Arbitrum Orbit L2, EVM) with **MetaMask** replacing Phantom. Read the spec for product intent, mix logic, security and Definition of Done; read this file for the chain, wallet and naming. Where they conflict on those three, this file wins.

**Do not add large product features, providers, tokenomics, or third-party services unless the owner asked.** Build with: minimum surface, maximum clarity, character, and reliability.

Owner: Clark79. Repo folder name is historical (`axiom_ai_scanner`). The product is **FONS**. Product ticker is **`$FONS`**. Those are different fields.

FONS is not affiliated with, endorsed by, or a partner of Robinhood Markets. It builds on the public Robinhood Chain network. Never write copy that implies otherwise.

---

## 0. Hard constraints

- Do not enable mainnet. Do not send a mainnet transaction.
- Do not deploy, commit, or push unless the owner explicitly asked.
- Do not `git reset` / `checkout` / `clean` / `stash` unrelated user work.
- Do not add Tailwind, GSAP, Three.js, Spline, P256K, Redux, a database, auth, or an embedded swap.
- Do not add a DEX router, an aggregator, or a bonding curve of your own. The launch path is `launchToken` on the deployed **Pons v2** factory.
- Do not treat a disabled placeholder, visual mock, or mocked success as a finished feature.
- Do not delete, skip, or weaken tests. Do not replace a real error with fake success.
- Do not invent contract addresses, chain ids, or RPC endpoints. Robinhood Chain: mainnet **4663** (`https://rpc.mainnet.chain.robinhood.com`), testnet **46630**, gas in **ETH**, explorer `https://robinhoodchain.blockscout.com`.
- The ABI in `web/src/chain/pons.ts` is transcribed from Pons's own MIT sources and every constant in it was read back off the deployed factory. Do not edit it from memory. Bytecode is still checked with `eth_getCode`, and the launch is simulated, before any signature is requested.
- Do not prefix server secrets with `VITE_` or `NEXT_PUBLIC_`.
- Windows PowerShell: use `;`, not `&&`. `$pid` is reserved.
- UI changes: verify behavior in the browser, not a single screenshot.

Status: launching through Pons v2 (2026-09-02). The factory is deployed and public, both launch flags default on, and SIGN unlocks only when the wallet is connected on chain 4663, the factory holds code, and the simulation passed.

---

## 1. What the product is

Tagline: **Two tokens in. One born.** / **Mix the logic. Launch what is born.**

FONS is an AI-native lab and Robinhood Chain launch interface. A user:

1. Picks two existing Robinhood Chain tokens.
2. Gets a *logically new* meme character (not a name concat).
3. Gets name, ticker (1–6), description, and one square avatar.
4. Edits everything.
5. Hands the draft to launch without a wallet prompt.
6. Signs `launchToken` on the Pons v2 factory in MetaMask.
7. Gets an ERC-20 trading on its own Pons bonding curve.

FONS is non-custodial. No FONS platform launch fee in MVP. Do not market it as “free launch” without saying gas and the optional initial buy still cost ETH. Do not promise profit.

AI produces **exactly four** outputs: name, ticker, description, one avatar. Not banners, token sites, stickers, X threads, video, or tokenomics.

Two flows must always work independently:

| Flow | Route | Rule |
|---|---|---|
| AI Mix | `/app/mix` | Search two parents → three concepts → pick one → one avatar → Use in Launch |
| Direct Launch | `/app/launch` | Manual form. Must work when AI keys / providers are down |

---

## 2. Brand (do not reinvent)

Restyled 2026-09-02 by owner instruction: the product was renamed **FONS** and the
visual language was rebuilt to match the LONS family of sites. The previous dark
MIXBORN system is preserved at tag `design-mixborn-dark` and branch
`design/mixborn-dark` — restore with `git checkout design-mixborn-dark`.

- **FONS** = site, app, brand name. **`$FONS`** = only the project's own token ticker.
- Wordmark story: `F[O]NS` — the **O** is born where parent A (warm) and parent B (cool) overlap (`Wordmark.tsx`).
- Palette: **daylight, no black anywhere.** Paper `#f2f5ee`, ink `#22331f` deep forest, glass whites, **sun `#d8a85e` = Parent A**, **sky `#8fb3c4` = Parent B**, moss `#5c7d50` for what is born, green only for confirmed on-chain, red only for errors. Tokens in `web/src/styles/tokens.css`.
- Type: Geist 700 for display and UI, IBM Plex Mono for wide-tracked micro labels (`--track-wide`). Headings are sentence case, never uppercase; **micro labels** carry the uppercase.
- Surfaces: frosted glass with a hairline edge and an inner highlight (`--inner-glass`). Panels 26px, cards 20px, pills for every action. One solid forest-green primary per view.
- Window chrome (`.chrome-bar` with `.chrome-lights` and `.chrome-glyphs`) frames the working parts, the way the reference frames its app.
- **The mark**: the owner's rendered logo, two interlocking glass rings, at `web/public/assets/brand/fons-mark.webp`. `GlassMark.tsx` loads it and drives state (`idle`, `searching`, `ready`, `mixing`, `generating`, `success`, `warning`, `wallet`, `launched`) through saturation and the halo; the drawn SVG rings inside it are only the fallback for when the image cannot be fetched.
- Small sizes use vector, not the render: `MergeMark` in `Wordmark.tsx` is the same two rings on the same diagonal, because the photographic version turns to mush below about 40px. Keep the two in sync if the logo changes.
- Token images that fail to load fall back to `assets/brand/token-fallback.webp`; the tab icon is `favicon.png` with `apple-touch-icon.png` alongside. The old `mark-merge-o.svg` and `favicon.svg` are retired.
- The hooded **BORN** mascot is **parked, not deleted**: `BornMascot.tsx` and `web/public/assets/brand/born-portrait.png` are still in the repo and unused. He returns only with glass art — see `docs/FONS_VISUAL_ASSETS.md`.
- Backgrounds are CSS gradients. `.scene` is where a photographic plate lands if one is added; the page must stay complete without it.
- Looping decorative motion **must stop** off-viewport and in a background tab (`data-page-hidden`, `data-offscreen`). Reduced-motion must keep the same information.
- Only animation runtime: **`motion`**. Simple effects stay CSS.

**Renamed in copy only.** These are contracts and were deliberately left alone:
`localStorage` keys (`mixborn.draftMix`, `mixborn.pendingLaunch`, `mixborn.analytics.*`, …),
the avatar style id `mixborn_lofi_v1` (validated server-side in `avatar_job.py`),
the env var name `MIXBORN_JOB_HMAC` (still read, though `FONS_JOB_HMAC` is now the
current name and the one actually set in production), and the multipart field `initial_buy_sol`
(client, `avatar_job.py` and `storage/metadata.py` all agree on that name;
the units are ETH regardless of what it is called). Renaming any of them is a
migration, not a restyle — `mixborn.pendingLaunch` in particular is the launch reconciliation record.

---

## 3. Repository map

```text
axiom_ai_scanner/
  AGENTS.md                          ← this file
  docs/FONS_PRODUCT_IMPLEMENTATION_SPEC.md
  docs/THIRD_PARTY_UI.md
  main.py                            local CLI + dashboard on :8080
  api/index.py                       Vercel Python entry (imports routes, does not duplicate logic)
  vercel.json                        static web/dist + /api rewrite + security headers
  vercel_api/                        HTTP dispatch, envelopes, routes
  axiom_scanner/                     scanner, mix, avatar jobs, security, Pinata
  tests/                             Python unit + integration
  web/                               Vite + React + TypeScript SPA
    src/app/                         router, config
    src/routes/                      landing, mix, launch, explore, token, legal
    src/components/                  brand, layout, mix, launch, token, wallet, ui
    src/domain/                      validation, draft, handoff, pendingLaunch
    src/services/                    api client, launchBoundary, analytics
    src/chain/                       viem clients, MetaMask (EIP-1193), pons, launchpad, units, errors
    src/styles/                      tokens, base, layout, ui, parts, mascot (glass mark), landing, app (no Tailwind)
```

Routes (`web/src/app/router.tsx`):

- `/` landing (hero **is** the mixer bench, feed, mascot, safety, FAQ, footer)
- `/app` → redirect `/app/mix`
- `/app/mix` AI Mix
- `/app/launch` launch form (AI handoff or direct)
- `/app/launch/success` only after on-chain mint exists
- `/app/explore` Trending / New / Mixable
- `/token/:mint` public token page, no database
- `/legal` `/safety` `/terms` `/privacy`

Local run:

```powershell
python main.py web --host 127.0.0.1 --port 8080
cd web
npm install
npm run dev
```

Open `http://127.0.0.1:5173`. Vite proxies `/api` to `:8080`.

Tests:

```powershell
python -m unittest discover -s tests
cd web
npm run typecheck
npm run lint
npm test
npm run build
```

`npm run lint` is a Vitest source/secret scan, not ESLint.

Git: large uncommitted FONS rewrite may sit on `main` on top of the old Axiom Meme Lab. Preserve unrelated diffs (for example scoring / wavespeed / http_client). `web/app.js` and `web/styles.css` are retired.

---

## 4. Features that already exist

### Discovery

- DexScreener adapter (`axiom_scanner/sources/dexscreener.py`).
- Search by name, ticker, contract address, DexScreener URL, Blockscout URL.
- Feed filters: trending, new, mixable. Score clamped 0–100, separate from risk.
- Missing metrics render **Unknown**. No fake volume/usage counters.
- Global search: mouse, `/`, Ctrl/Cmd+K.

### AI Mix

- Two different parent addresses required.
- `POST /api/mix/concepts` → OpenAI Structured Outputs, else a **labeled** deterministic fallback (“Basic mix mode”). Never silent fake AI.
- Three concepts, one `recommended`. User selects a concept **before** avatar generation.
- One generate action → one avatar job. Start + status polling. Survives >60s. HMAC job token (`FONS_JOB_HMAC`, with `MIXBORN_JOB_HMAC` and `JOB_TOKEN_HMAC_SECRET` still accepted).
- Prompt injection stripped from parent text. Duplicate in-flight job rejected.
- **Use in Launch** writes draft to `localStorage` without opening the wallet. Avatar bytes live in memory (`web/src/domain/avatarMemory.ts`). After reload, a blob URL is gone — say so, do not pretend the image is still there.

### Direct Launch

- Works without AI keys.
- Avatar crop → 1024×1024 PNG (client + server re-encode).
- Name 2–32, ticker 1–6 alphanumeric, description 1–500, https-only socials.
- Initial buy default `0`. Presets. Cap from env (`INITIAL_BUY_MAX_ETH` / `VITE_INITIAL_BUY_MAX_ETH`).
- Rights and risk checkboxes are not pre-checked.
- Review shows cost and mechanics. Until native launch is on, sign stays disabled with an honest reason.

### Robinhood Chain launch (live, through Pons v2)

- `viem` + MetaMask over raw EIP-1193. No wallet-adapter package: the browser already exposes the interface.
- Never eager-connects. `eth_accounts` only reflects a grant the user already gave; `eth_requestAccounts` runs on click.
- Wrong network is offered `wallet_switchEthereumChain`, falling back to `wallet_addEthereumChain` on code 4902.
- `eth_getCode` **before** the wallet prompt. Simulation required. No hidden FONS fee argument: FONS takes nothing, and the only value on the launch call is Pons's own `launchFee()`.
- `msg.value` must equal `launchFee()` **exactly** or the factory reverts, so the optional opening buy cannot ride along. It is a second transaction against the curve, sent only after the launch is confirmed and persisted, and a declined buy must never read as a failed launch.
- `expectedEconomics` is pinned from `previewLaunchEconomics` at simulation time, so an owner re-peg between quoting and signing reverts instead of repricing the launch silently.
- The CREATE2 `salt` is fresh random bytes per launch. Never reuse one.
- RPC only through `/api/chain/rpc` with an allowlist that contains **no write method** — `eth_sendRawTransaction` is absent, so no flag can enable a server-side send. Signing happens in the wallet and never touches the server.
- Pending launch reconciliation on reload — do not auto-duplicate a launch.
- Success page waits for the receipt and for the token bytecode to exist, not a toast.
- `ENABLE_NATIVE_LAUNCH` and `ENABLE_MAINNET_LAUNCH` both default **on** now. Either one set to `false` switches launching off, on the server and in the client independently.

### Token page

- No database. Compose DexScreener + RPC + metadata.
- An address is a token only if it has bytecode **and** answers `symbol()` and `decimals()`. An EOA is not a token. When the node cannot answer, say unknown — that is not the same as absent.
- Trade link goes to the Pons curve first; DexScreener only has a chart once the launch graduates. No embedded swap.

### Security (do not weaken)

- SSRF-safe fetch: localhost, private, link-local, cloud metadata, DNS-to-loopback, redirects, IPv6 `::1` / unique-local, `.local`.
- Images: magic-byte sniff, SVG reject, size/pixel limits, decompression bombs, spoofed MIME ignored.
- JSON envelope: `{ success, data, error: { code, message }, request_id }`. Never leak provider secrets.
- CSP, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, Referrer-Policy, Permissions-Policy.
- Separate rate limits on mix / avatar / metadata / RPC.
- `web/src` must not use `dangerouslySetInnerHTML` or `eval`.
- Client bundle must not contain `PINATA_JWT`, `OPENAI_API_KEY`, HMAC secrets.

### Third-party UI

Documented in `docs/THIRD_PARTY_UI.md`: wallet-adapter-react-ui (Apache-2.0), motion (MIT), Fontsource fonts (OFL). Everything else is local FONS CSS/React.

---

## 5. API

Dispatcher: `vercel_api/dispatch.py`. Same handlers from `main.py` locally and `api/index.py` on Vercel.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | Pinned SDK version, cluster, flags; must not echo secrets |
| GET | `/api/search` | Token search |
| GET | `/api/feed` | Trending / new / mixable |
| GET | `/api/token/:address` | Public token composition |
| POST | `/api/mix/concepts` | Logical mix |
| POST | `/api/mix/avatar/start` | Multipart parent images + fields |
| GET | `/api/mix/avatar/status?job=` | Poll HMAC job token |
| POST | `/api/metadata/pin` | Pinata image + JSON |
| GET | `/api/launch/name-check` | Informational similar-name notice; does not block |
| POST | `/api/chain/rpc` | Allowlisted read-only JSON-RPC |

Legacy Meme Mixer paths still exist (`/api/scan`, `/api/hybrid-image`, `/api/narratives`). Do not treat them as the FONS product path. New mix is `/api/mix/concepts` + avatar jobs.

Vercel: `outputDirectory` is `web/dist`. **`vercel.json` carries no rewrites** — the platform now routes internal rewrites in backend-framework projects by the rewritten destination path, which silently broke every route. `api/index.py` serves both the API and the static SPA.

---

## 6. Config and flags

Safe defaults — keep them unless the owner explicitly enables launch:

```text
ROBINHOOD_RPC_URL=https://rpc.mainnet.chain.robinhood.com
# PONS_FACTORY_ADDRESS=            # defaults to the verified v2 factory
ENABLE_NATIVE_LAUNCH=true
ENABLE_MAINNET_LAUNCH=true
# VITE_PONS_FACTORY_ADDRESS=
# VITE_ENABLE_NATIVE_LAUNCH=false  # only "false" turns it off
# VITE_ENABLE_MAINNET_LAUNCH=false
```

Frontend flags live in `web/src/app/config.ts`. Server flags live in `vercel_api/launch_config.py`. A public Vite flag is **not** a security boundary; the server must enforce the same kill switches.

Server-only secrets (never `VITE_`): `OPENAI_API_KEY`, `WAVESPEED_API_KEY`, `PINATA_JWT`, `FONS_JOB_HMAC`.

Without secrets: mix uses labeled fallback, avatar/metadata report unavailable, Direct Launch still works. That is correct.

Mainnet (4663) is the default because it is the only published RPC. Safety does not rest on the network default: every launch is simulated against the real factory and signed in the user's own wallet, and either kill switch stops the path outright.

---

## 7. Where to edit

| Task | Start here |
|---|---|
| Feature flags | `web/src/app/config.ts`, `vercel_api/launch_config.py` |
| Mix logic | `axiom_scanner/analysis/logical_mixer.py`, `mix_schema.py`, `mix_fallback.py` |
| Mix UI | `web/src/routes/mix/MixPage.tsx` |
| Avatar jobs | `axiom_scanner/analysis/avatar_job.py`, `vercel_api/routes/avatar.py` |
| Launch form | `web/src/routes/launch/LaunchPage.tsx` |
| Review / sign gate | `web/src/components/launch/LaunchReview.tsx`, `web/src/services/launchBoundary.ts` |
| Launch transaction | `web/src/chain/pons.ts` (ABI, terms), `launchpad.ts` (flow), `wallet.tsx`, `errors.ts` |
| Draft / handoff | `web/src/domain/draft.ts`, `handoff.ts`, `pendingLaunch.ts`, `avatarMemory.ts` |
| Validation | `web/src/domain/validation.ts` (zod), `axiom_scanner/security/fields.py` |
| SSRF / images | `axiom_scanner/security/fetch.py`, `images.py` |
| RPC proxy | `vercel_api/routes/rpc.py` |
| Token honesty | `vercel_api/routes/token.py`, `web/src/chain/tokenOnchain.ts` |
| Brand motion | `Wordmark.tsx`, `GlassMark.tsx`, `Atmosphere.tsx`, `PageShell.tsx` |
| API envelope | `vercel_api/envelope.py`, `web/src/services/api.ts` |
| Security headers | `vercel_api/security_headers.py`, `vercel.json` |

---

## 8. Manual blockers (do not simulate)

Mark these MANUAL. Do not fake a passing E2E.

- Signed launch with real ETH: MetaMask, the 0.0005 ETH fee, confirm, reconciliation, opening buy
- Live OpenAI / WaveSpeed / Pinata
- Production domain, social handles, legal review
- Final mascot restyle assets
- Any change to the Pons factory address (owner only; re-verify on chain first)
- Production Lighthouse LCP/CLS
- `npm audit` findings — do not `audit fix --force` without review

---

## 9. Chain facts (do not “simplify”)

- Robinhood Chain is an Arbitrum Orbit L2 on Arbitrum Nitro, EVM-equivalent. Gas is paid in **ETH**, not in a Robinhood token.
- Mainnet `4663` · RPC `https://rpc.mainnet.chain.robinhood.com` · explorer `https://robinhoodchain.blockscout.com`. Testnet is `46630`; no public testnet RPC is published, which is why mainnet is the read default.
- DexScreener indexes the network under the slug `robinhood`. That is what makes two-parent discovery work.
- Pons v2 factory `0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e`. Read off chain: `launchFee()` 0.0005 ETH, `launchEnabled()` true, `launchConfigCount()` 1 (so `launchConfigId` is `0`), `maxCreatorTaxBps()` 1000. `pairToken == address(0)` selects the native ETH curve.
- Sources: github.com/ponsdotdev/ponsfamily (MIT) and docs.ponsfamily.com/v2. Re-verify against the chain with `node --import tsx web/scripts/verify-pons.mjs` rather than trusting a doc page.
- The atomic launch-and-buy router (`launchForwarder`, `0xe33E9E479dF8802cb0866d5d05258bEc4cF62948`) is deployed but its source is unpublished. Do not guess its ABI.
- A zero platform fee is not a zero wallet debit — gas and the optional initial buy still cost ETH.
- Mainnet integration tests must never run automatically in CI.
