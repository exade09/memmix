# MIXBORN third-party UI

Materially reused UI is limited to wallet chrome and the animation runtime. Cards, buttons, landing, mix, launch, explore, token and legal screens are local MIXBORN CSS and React.

| Component | Source URL | Author | License | Attribution | Dependencies kept | Local modifications | Telemetry / remote scripts | Copied demo media |
|---|---|---|---|---|---|---|---|---|
| Wallet modal / connect button styles | https://github.com/anza-xyz/wallet-adapter/tree/master/packages/ui/react-ui | Solana / Anza wallet-adapter maintainers | Apache-2.0 | Package copyright retained in `node_modules/@solana/wallet-adapter-react-ui` | `@solana/wallet-adapter-react-ui@0.9.39` (depends on adapter-base/react) | Theme overridden by MIXBORN CSS tokens; no WalletConnect extra adapters; `wallets={[]}` uses Wallet Standard only | None added by MIXBORN. Vendor modal uses in-memory `innerHTML` for its own markup; MIXBORN `web/src` does not call `dangerouslySetInnerHTML`. | None |
| Motion runtime | https://github.com/motiondivision/motion | Motion (formerly Framer Motion) | MIT | Package license in `node_modules/motion` | `motion@^13` is the only animation runtime | Reduced-motion paths; looping effects pause off-screen and in background tabs | No MIXBORN telemetry | None |
| Geist / IBM Plex Mono / Space Grotesk / Instrument Serif fonts | https://fontsource.org/ | Fontsource redistributes original foundries | SIL OFL (upstream fonts) | Distributed via `@fontsource*` packages | Self-hosted woff2, no Google Fonts runtime | Loaded as local `@fontsource` CSS | No remote font CDN | None |

Not used: Tailwind, GSAP, Three.js, Spline, P256K, 21st.dev registry copies, remote executable widget scripts.

Removed / not shipped: the obsolete `web/app.js` Meme Mixer dashboard.
