export const appConfig = {
  productName: "MIXBORN",
  tokenSymbol: "MIXBRN",
  primaryTagline: "Two tokens in. One born.",
  secondaryTagline: "Mix the logic. Launch what is born.",
  canonicalUrl: import.meta.env.VITE_CANONICAL_URL ?? "",
  cluster: import.meta.env.VITE_SOLANA_CLUSTER === "mainnet-beta" ? "mainnet-beta" : "devnet",
  enableAiText: import.meta.env.VITE_ENABLE_AI_TEXT !== "false",
  enableAiImage: import.meta.env.VITE_ENABLE_AI_IMAGE !== "false",
  enableNativeLaunch: import.meta.env.VITE_ENABLE_NATIVE_LAUNCH === "true",
  enableMainnetLaunch: import.meta.env.VITE_ENABLE_MAINNET_LAUNCH === "true",
  enableBagsFallback: import.meta.env.VITE_ENABLE_BAGS_INTENT_FALLBACK === "true",
  platformTokenMint: import.meta.env.VITE_PLATFORM_TOKEN_MINT ?? "",
  initialBuyMaxSol: Number(import.meta.env.VITE_INITIAL_BUY_MAX_SOL || "5") || 5,
} as const;

export function clusterLabel(cluster: string = appConfig.cluster): string {
  return cluster === "mainnet-beta" ? "SOLANA MAINNET" : "SOLANA DEVNET";
}
