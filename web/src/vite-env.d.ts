/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CANONICAL_URL?: string;
  readonly VITE_SOLANA_CLUSTER?: "devnet" | "mainnet-beta" | string;
  readonly VITE_ENABLE_AI_TEXT?: string;
  readonly VITE_ENABLE_AI_IMAGE?: string;
  readonly VITE_ENABLE_NATIVE_LAUNCH?: string;
  readonly VITE_ENABLE_MAINNET_LAUNCH?: string;
  readonly VITE_ENABLE_BAGS_INTENT_FALLBACK?: string;
  readonly VITE_PLATFORM_TOKEN_MINT?: string;
  readonly VITE_INITIAL_BUY_MAX_ETH?: string;
  readonly VITE_PONS_FACTORY_ADDRESS?: string;
  readonly VITE_ANALYTICS_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
