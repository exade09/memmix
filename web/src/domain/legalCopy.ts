export const SAFETY_PROMISE =
  "Your keys stay in your wallet. MIXBORN builds and checks the launch transaction; only you can sign it. We never ask for a seed phrase or private key.";

export const RISK_DISCLOSURE =
  "Token creation and trading are risky. MIXBORN does not guarantee value, liquidity, market integrity or profit. Review every transaction and every external link yourself.";

export const FOOTER_DISCLAIMER =
  "MIXBORN is an independent interface using public Solana programs. It is not a promise of endorsement by Pump.fun, Solana or any token shown in the feed. Nothing on this site is financial advice.";

export const ZERO_PLATFORM_FEE =
  "Pump.fun currently lists a 0 SOL creation fee, and MIXBORN adds no platform launch fee in this version. Solana network fees, account rent and any initial buy still cost SOL. The app shows an estimate before you sign.";

export const INDEXER_NOTICE =
  "The token is live on-chain. Market data will appear after external indexers discover trading activity.";

export const DEVNET_LAUNCH_NOTICE =
  "Launch is in devnet mode. Tokens created here have no mainnet market value.";

export const FAQ_ITEMS = [
  ["What does MIXBORN do?", "MIXBORN combines the character logic of two existing Solana tokens, generates one editable token concept and lets you launch that concept through the Pump protocol. You can also skip AI and launch manually."],
  ["Is token creation free?", ZERO_PLATFORM_FEE],
  ["Does MIXBORN hold my funds?", "No. MIXBORN is non-custodial. Your wallet signs the transaction and remains in control of its funds."],
  ["Can AI launch a token without me?", "No. AI only produces editable creative fields. It cannot connect your wallet, sign a transaction or launch a token for you."],
  ["Can I launch without using AI?", "Yes. Direct Launch accepts your own name, ticker, description, image and links."],
  ["Can I edit the generated result?", "Yes. Every generated field is editable before metadata is pinned and the transaction is signed."],
  ["Is a token launched here guaranteed to be safe?", "MIXBORN protects the launch workflow by keeping keys in your wallet, checking expected program IDs and simulating the transaction. It cannot guarantee the future behaviour, market, holders, links or price of any token."],
  ["Does MIXBORN guarantee profit?", "No. MIXBORN does not provide investment advice or predict returns."],
  ["Can metadata be edited after launch?", "Treat submitted token data as permanent. Review the name, ticker, image, description and links before signing."],
  ["Who is responsible for uploaded and generated content?", "The launcher is responsible for having the right to use uploaded names, images and links. AI output must also be reviewed before launch."],
] as const;

export const NOT_PROMISED = [
  "profit or investment outcome",
  "a trend, listing or lasting market",
  "liquidity or price growth",
  "that a token cannot be rugged",
  "absolute safety of any token",
  "safety of third-party links",
] as const;

export const CONTENT_POLICY = [
  "sexual content involving minors",
  "explicit gore",
  "targeted hate",
  "doxxing and private personal data",
  "impersonation intended to deceive",
  "phishing links",
  "instructions for market manipulation",
  "false claims of official partnership",
  "direct copyrighted character copy when the user has no rights",
] as const;

export const PRIVACY_COPY =
  "MVP collects only technical logs necessary for reliability: request id, endpoint, status, duration, coarse rate-limit key, provider status and transaction signature after user submission. Wallet balances, raw uploaded images, full AI prompts containing user data, signed transaction bytes, auth headers, API keys and private keys are not logged. IP addresses are not kept longer than abuse protection requires. Optional anonymous product events never include a raw wallet address.";

export const SAFETY_PILLARS = [
  ["NON-CUSTODIAL", "We never receive your seed phrase or private key."],
  ["VERIFIED PATH", "Launch transactions may call only the configured Pump and Solana programs."],
  ["COST BEFORE SIGN", "You see the estimated debit and optional buy before the wallet opens."],
  ["MARKET REALITY", "We do not promise profit, liquidity or honest third parties."],
] as const;

export function shareLaunchCopy(input: {
  name: string;
  ticker: string;
  pumpUrl: string;
  parentA?: string;
  parentB?: string;
}): string {
  const title = `${input.name} ($${input.ticker})`;
  if (input.parentA && input.parentB) {
    return `${title} was born from ${input.parentA} + ${input.parentB} in MIXBORN. ${input.pumpUrl}`;
  }
  return `${title} was born in MIXBORN. ${input.pumpUrl}`;
}

export function pumpCoinUrl(mint: string): string {
  return `https://pump.fun/coin/${mint}`;
}

export function solscanTxUrl(signature: string, cluster: string): string {
  const base = `https://solscan.io/tx/${signature}`;
  return cluster === "mainnet-beta" ? base : `${base}?cluster=devnet`;
}

export function solscanAccountUrl(address: string, cluster: string): string {
  const base = `https://solscan.io/account/${address}`;
  return cluster === "mainnet-beta" ? base : `${base}?cluster=devnet`;
}
