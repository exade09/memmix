# MIXBORN — agent briefing

Read this file before changing the repo. It is the working brief for coding agents. The product specification remains the source of truth:

- Product / brand / launch / security / Definition of Done: [`docs/MIXBORN_PRODUCT_IMPLEMENTATION_SPEC.md`](docs/MIXBORN_PRODUCT_IMPLEMENTATION_SPEC.md)
- Reused UI licenses: [`docs/THIRD_PARTY_UI.md`](docs/THIRD_PARTY_UI.md)
- Human README: [`README.md`](README.md)

If implementation diverges from the specification, the specification wins — except confirmed Pump SDK / Solana protocol / security constraints and explicit owner instructions.

**Do not add large product features, providers, tokenomics, or third-party services unless the owner asked.** Build with: minimum surface, maximum clarity, character, and reliability.

Owner: Clark79. Repo folder name is historical (`axiom_ai_scanner`). The product is **MIXBORN**. Product ticker is **`$MIXBRN`**. Those are different fields.

---

## 0. Hard constraints

- Do not enable mainnet. Do not send a mainnet transaction.
- Do not deploy, commit, or push unless the owner explicitly asked.
- Do not `git reset` / `checkout` / `clean` / `stash` unrelated user work.
- Do not add Tailwind, GSAP, Three.js, Spline, P256K, Redux, a database, auth, or an embedded swap.
- Do not add Raydium, Meteora, Jupiter Studio, or a custom bonding-curve program. Pump `create_v2` is the MVP launch path. Bags Launch Intent is a hidden emergency flag only.
- Do not treat a disabled placeholder, visual mock, or mocked success as a finished feature.
- Do not delete, skip, or weaken tests. Do not replace a real error with fake success.
- Do not invent Pump program IDs from social posts. Use the pinned SDK and official docs.
- Do not prefix server secrets with `VITE_` or `NEXT_PUBLIC_`.
- Windows PowerShell: use `;`, not `&&`. `$pid` is reserved.
- UI changes: verify behavior in the browser, not a single screenshot.

Status at Stage 10 (2026-08-25): **RELEASE CANDIDATE READY** for preview / devnet acceptance. Native launch is off. Mainnet is off. That is intentional.

---

## 1. What the product is

Tagline: **Two tokens in. One born.** / **Mix the logic. Launch what is born.**

MIXBORN is an AI-native lab and Solana launch interface. A user:

1. Picks two existing Solana tokens.
2. Gets a *logically new* meme character (not a name concat).
3. Gets name, ticker (1–6), description, and one square avatar.
4. Edits everything.
5. Hands the draft to launch without a wallet prompt.
6. Signs Pump `create_v2` in their own wallet.
7. Gets a token on the Pump bonding curve.

MIXBORN is non-custodial. No MIXBORN platform launch fee in MVP. Do not market it as “free launch” without saying Solana fees / rent / optional initial buy still cost SOL. Do not promise profit.

AI produces **exactly four** outputs: name, ticker, description, one avatar. Not banners, token sites, stickers, X threads, video, or tokenomics.

Two flows must always work independently:

| Flow | Route | Rule |
|---|---|---|
| AI Mix | `/app/mix` | Search two parents → three concepts → pick one → one avatar → Use in Launch |
| Direct Launch | `/app/launch` | Manual form. Must work when AI keys / providers are down |

---

## 2. Brand (do not reinvent)

Redesigned 2026-08-30 by owner instruction. The visual system below supersedes the
palette/typography in section 4 of the product specification; everything else in the
specification still applies.

- **MIXBORN** = site, app, brand name. **`$MIXBRN`** = only the project’s own token ticker.
- Wordmark story: `MIXB[ ]RN` — the **O** is born when parent A (left) and parent B (right) merge (`Wordmark`).
- Palette: pure black ground, cream `#f2efe8` type, **copper `#d08a45` = Parent A / warm / primary accent**, **ash `#7f97b5` = Parent B / cool**, cream-white = what is BORN, green only for on-chain confirmed, red only for errors. The copper is taken from BORN's robe. Never two loud accent fields at once. Tokens in `web/src/styles/tokens.css`.
- Type: Instrument Serif (display), Geist (UI), IBM Plex Mono (data/labels), Space Grotesk (wordmark + big stat numbers). Headlines are sentence case, not uppercase.
- Shapes: pill actions, 24px panels, 18px cards, 16px avatars. One solid cream primary button per view.
- Mascot **BORN**: hooded handmade line-art with a black void for a face. `web/src/components/brand/BornMascot.tsx` draws him as SVG (portrait only; the full-body variant was removed at the owner's request to reduce how much of the page he occupies). On the landing page he is the output slot of the hero bench. The void **is** the merge core: Parent A enters as a copper orb, Parent B as an ash orb, they merge, and the born mark appears. States: `idle`, `searching`, `ready`, `mixing`, `generating`, `success`, `warning`, `wallet`, `launched`.
- He sits on a bone "specimen plate" because black ink does not read on a black page. `web/public/assets/brand/born-portrait.png` is the real drawing and is preloaded from `index.html`; the SVG renders only if that file fails. Do not fake a final art pass — replace the file.
- Looping decorative motion **must stop** off-viewport and in a background tab (`data-page-hidden`, `data-offscreen`). Reduced-motion must keep the same information.
- Only animation runtime: **`motion`**. Simple effects stay CSS.
- No old “Meme Mixer” / “MemMix” branding in UI. Legacy CLI copy in README is historical.

---

## 3. Repository map

```text
axiom_ai_scanner/
  AGENTS.md                          ← this file
  docs/MIXBORN_PRODUCT_IMPLEMENTATION_SPEC.md
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
    src/services/                    api client, pumpBoundary, analytics
    src/solana/                      Pump SDK launch, allowlists, mint memory
    src/styles/                      tokens, base, layout, ui, parts, mascot, landing, app (no Tailwind)
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

Git: large uncommitted MIXBORN rewrite may sit on `main` on top of the old Axiom Meme Lab. Preserve unrelated diffs (for example scoring / wavespeed / http_client). `web/app.js` and `web/styles.css` are retired.

---

## 4. Features that already exist

### Discovery

- DexScreener adapter (`axiom_scanner/sources/dexscreener.py`).
- Search by name, ticker, mint, Pump URL, DexScreener URL.
- Feed filters: trending, new, mixable. Score clamped 0–100, separate from risk.
- Missing metrics render **Unknown**. No fake volume/usage counters.
- Global search: mouse, `/`, Ctrl/Cmd+K.

### AI Mix

- Two different parent mints required.
- `POST /api/mix/concepts` → OpenAI Structured Outputs, else a **labeled** deterministic fallback (“Basic mix mode”). Never silent fake AI.
- Three concepts, one `recommended`. User selects a concept **before** avatar generation.
- One generate action → one avatar job. Start + status polling. Survives >60s. HMAC job token (`MIXBORN_JOB_HMAC` or alias `JOB_TOKEN_HMAC_SECRET`).
- Prompt injection stripped from parent text. Duplicate in-flight job rejected.
- **Use in Launch** writes draft to `localStorage` without opening the wallet. Avatar bytes live in memory (`web/src/domain/avatarMemory.ts`). After reload, a blob URL is gone — say so, do not pretend the image is still there.

### Direct Launch

- Works without AI keys.
- Avatar crop → 1024×1024 PNG (client + server re-encode).
- Name 2–32, ticker 1–6 alphanumeric, description 1–500, https-only socials.
- Initial buy default `0`. Presets. Cap from env (`INITIAL_BUY_MAX_SOL` / `VITE_INITIAL_BUY_MAX_SOL`).
- Rights and risk checkboxes are not pre-checked.
- Review shows cost and mechanics. Until native launch is on, sign stays disabled with an honest reason.

### Solana launch (wired, flag off)

- Official `@pump-fun/pump-sdk@1.36.0`, `create_v2`, quote SOL, Mayhem false, Cashback false.
- Mint keypair created in the browser. Never sent to the server. Never logged.
- Program allowlist **before** wallet prompt. Simulation required. No hidden MIXBORN fee instruction.
- RPC only through `/api/solana/rpc` with an allowlist. `sendTransaction` is blocked while native launch is off; mainnet also needs `ENABLE_MAINNET_LAUNCH`.
- Pending launch reconciliation on reload — do not auto-duplicate a launch.
- Success page waits for on-chain mint, not a toast.

### Token page

- No database. Compose DexScreener + RPC + metadata.
- An account is a mint only if owner is Token Program or Token-2022. System Program `11111111…` is **not** a token. Do not say “live on-chain” for a non-mint account.
- External trade link to Pump. No embedded swap.

### Security (do not weaken)

- SSRF-safe fetch: localhost, private, link-local, cloud metadata, DNS-to-loopback, redirects, IPv6 `::1` / unique-local, `.local`.
- Images: magic-byte sniff, SVG reject, size/pixel limits, decompression bombs, spoofed MIME ignored.
- JSON envelope: `{ success, data, error: { code, message }, request_id }`. Never leak provider secrets.
- CSP, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, Referrer-Policy, Permissions-Policy.
- Separate rate limits on mix / avatar / metadata / RPC.
- `web/src` must not use `dangerouslySetInnerHTML` or `eval`.
- Client bundle must not contain `PINATA_JWT`, `OPENAI_API_KEY`, HMAC secrets.

### Third-party UI

Documented in `docs/THIRD_PARTY_UI.md`: wallet-adapter-react-ui (Apache-2.0), motion (MIT), Fontsource fonts (OFL). Everything else is local MIXBORN CSS/React.

---

## 5. API

Dispatcher: `vercel_api/dispatch.py`. Same handlers from `main.py` locally and `api/index.py` on Vercel.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | Pinned SDK version, cluster, flags; must not echo secrets |
| GET | `/api/search` | Token search |
| GET | `/api/feed` | Trending / new / mixable |
| GET | `/api/token/:mint` | Public token composition |
| POST | `/api/mix/concepts` | Logical mix |
| POST | `/api/mix/avatar/start` | Multipart parent images + fields |
| GET | `/api/mix/avatar/status?job=` | Poll HMAC job token |
| POST | `/api/metadata/pin` | Pinata image + JSON |
| GET | `/api/launch/name-check` | Informational similar-name notice; does not block |
| POST | `/api/solana/rpc` | Allowlisted JSON-RPC |

Legacy Meme Mixer paths still exist (`/api/scan`, `/api/hybrid-image`, `/api/narratives`). Do not treat them as the MIXBORN product path. New mix is `/api/mix/concepts` + avatar jobs.

Vercel: `outputDirectory` is `web/dist`. `/api/:path*` rewrites to `api/index.py`. SPA fallback is `index.html`.

---

## 6. Config and flags

Safe defaults — keep them unless the owner explicitly enables launch:

```text
SOLANA_CLUSTER=devnet
SOLANA_RPC_URL=https://api.devnet.solana.com
ENABLE_NATIVE_LAUNCH=false
ENABLE_MAINNET_LAUNCH=false
VITE_SOLANA_CLUSTER=devnet
VITE_ENABLE_NATIVE_LAUNCH=false    # only "true" turns it on
VITE_ENABLE_MAINNET_LAUNCH=false
VITE_ENABLE_BAGS_INTENT_FALLBACK=false
```

Frontend flags live in `web/src/app/config.ts`. Server flags live in `vercel_api/launch_config.py`. A public Vite flag is **not** a security boundary; the server must enforce the same kill switches.

Server-only secrets (never `VITE_`): `OPENAI_API_KEY`, `WAVESPEED_API_KEY`, `PINATA_JWT`, `MIXBORN_JOB_HMAC` / `JOB_TOKEN_HMAC_SECRET`.

Without secrets: mix uses labeled fallback, avatar/metadata report unavailable, Direct Launch still works. That is correct.

Pinned launch SDK version must stay `1.36.0` in both `web/package.json` and `vercel_api/launch_config.py` until the owner retraces official Pump docs.

---

## 7. Where to edit

| Task | Start here |
|---|---|
| Feature flags | `web/src/app/config.ts`, `vercel_api/launch_config.py` |
| Mix logic | `axiom_scanner/analysis/logical_mixer.py`, `mix_schema.py`, `mix_fallback.py` |
| Mix UI | `web/src/routes/mix/MixPage.tsx` |
| Avatar jobs | `axiom_scanner/analysis/avatar_job.py`, `vercel_api/routes/avatar.py` |
| Launch form | `web/src/routes/launch/LaunchPage.tsx` |
| Review / sign gate | `web/src/components/launch/LaunchReview.tsx`, `web/src/services/pumpBoundary.ts` |
| Pump transaction | `web/src/solana/pumpLaunch.ts`, `programAllowlist.ts`, `mintMemory.ts` |
| Draft / handoff | `web/src/domain/draft.ts`, `handoff.ts`, `pendingLaunch.ts`, `avatarMemory.ts` |
| Validation | `web/src/domain/validation.ts` (zod), `axiom_scanner/security/fields.py` |
| SSRF / images | `axiom_scanner/security/fetch.py`, `images.py` |
| RPC proxy | `vercel_api/routes/rpc.py` |
| Token honesty | `vercel_api/routes/token.py`, `web/src/solana/tokenOnchain.ts` |
| Brand motion | `Wordmark.tsx`, `BornMascot.tsx`, `Atmosphere.tsx`, `PageShell.tsx` |
| API envelope | `vercel_api/envelope.py`, `web/src/services/api.ts` |
| Security headers | `vercel_api/security_headers.py`, `vercel.json` |

---

## 8. Manual blockers (do not simulate)

Mark these MANUAL. Do not fake a passing E2E.

- Devnet signed launch: Phantom + a second wallet, simulation, confirm, reconciliation
- Live OpenAI / WaveSpeed / Pinata
- Production domain, social handles, legal review
- Final mascot restyle assets
- Enabling `ENABLE_NATIVE_LAUNCH` / `VITE_ENABLE_NATIVE_LAUNCH` (owner only, after devnet acceptance)
- Production Lighthouse LCP/CLS
- `npm audit` findings — do not `audit fix --force` without review

---

## 9. Launch provider facts (do not “simplify”)

- Official package: https://www.npmjs.com/package/@pump-fun/pump-sdk
- Docs: https://github.com/pump-fun/pump-public-docs
- `create_v2` 0 SOL creation fee ≠ 0 wallet debit (network fee, rent, optional buy).
- Undocumented Pump frontend HTTP APIs are not a supported architecture.
- Mainnet integration tests must never run automatically in CI.
