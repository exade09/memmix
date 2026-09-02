# FONS third-party UI

Materially reused UI is now limited to the animation runtime. Cards, buttons, landing, mix, launch, explore, token and legal screens are local FONS CSS and React.


| Component | Source URL | Author | License | Attribution | Dependencies kept | Local modifications | Telemetry / remote scripts | Copied demo media |
|---|---|---|---|---|---|---|---|---|
| Chain client (not UI) | https://github.com/wevm/viem | wevm | MIT | Package license in `node_modules/viem` | `viem@^2` for RPC encoding, simulation and receipts | Reads go through `/api/chain/rpc`, never a public RPC directly; no vendor UI is imported | No FONS telemetry | None |
| Motion runtime | https://github.com/motiondivision/motion | Motion (formerly Framer Motion) | MIT | Package license in `node_modules/motion` | `motion@^13` is the only animation runtime | Reduced-motion paths; looping effects pause off-screen and in background tabs | No FONS telemetry | None |
| Geist / IBM Plex Mono fonts | https://fontsource.org/ | Fontsource redistributes original foundries | SIL OFL (upstream fonts) | Distributed via `@fontsource*` packages | Self-hosted woff2, no Google Fonts runtime. Instrument Serif and Space Grotesk are installed but no longer imported after the FONS restyle | Loaded as local `@fontsource` CSS | No remote font CDN | None |

Not used: Tailwind, GSAP, Three.js, Spline, P256K, 21st.dev registry copies, remote executable widget scripts.

Removed / not shipped: the obsolete `web/app.js` Meme Mixer dashboard.
