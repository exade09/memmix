import { ROBINHOOD_MAINNET_ID, ROBINHOOD_TESTNET_ID, chainLabel } from "../chain/robinhood";

const mainnet = import.meta.env.VITE_ROBINHOOD_TESTNET !== "true";

export const appConfig = {
  productName: "FONS",
  tokenSymbol: "FONS",
  primaryTagline: "Two tokens in One born",
  secondaryTagline: "Mix two. Launch one.",
  canonicalUrl: import.meta.env.VITE_CANONICAL_URL ?? "",
  /** Mainnet by default: it is the only published RPC. Launching stays gated. */
  mainnet,
  chainId: mainnet ? ROBINHOOD_MAINNET_ID : ROBINHOOD_TESTNET_ID,
  enableAiText: import.meta.env.VITE_ENABLE_AI_TEXT !== "false",
  enableAiImage: import.meta.env.VITE_ENABLE_AI_IMAGE !== "false",
  /*
    On by default now that launching runs through the deployed Pons v2
    factory rather than a contract that did not exist. Set either flag to
    "false" to switch the path back off; the server holds the same two
    switches independently.
  */
  enableNativeLaunch: import.meta.env.VITE_ENABLE_NATIVE_LAUNCH !== "false",
  enableMainnetLaunch: import.meta.env.VITE_ENABLE_MAINNET_LAUNCH !== "false",
  platformTokenAddress: import.meta.env.VITE_PLATFORM_TOKEN_ADDRESS ?? "",
  initialBuyMaxEth: Number(import.meta.env.VITE_INITIAL_BUY_MAX_ETH || "0.5") || 0.5,
  /*
    Off by default: the whole app runs normally. Set to "true" to put a
    "coming soon" gate up on every route except /admin/ca, without removing
    or touching anything underneath -- flip it back off and redeploy to
    restore the site exactly as it was.
  */
  siteGateEnabled: import.meta.env.VITE_SITE_GATE_ENABLED === "true",
} as const;

export function networkLabel(chainId: number = appConfig.chainId): string {
  return chainLabel(chainId);
}
