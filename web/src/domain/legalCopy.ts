export const RISK_DISCLOSURE =
  "Token creation and trading are risky. FONS does not guarantee value, liquidity, market integrity or profit. Review every transaction and every external link yourself.";

export const FOOTER_DISCLAIMER =
  "FONS is an independent interface that launches tokens through public contracts on Robinhood Chain. It is not affiliated with, endorsed by, or a partner of Robinhood Markets or of the launch contracts it builds on, and it is not a promise of endorsement by any token shown in the feed. Nothing on this site is financial advice.";

export const ZERO_PLATFORM_FEE =
  "FONS pays the launch contract's fee and gas for you by default, from its own wallet. Launching costs 0 ETH. You can still choose to pay it yourself instead — that costs the launch contract's fee, currently 0.0005 ETH and read live from the contract, plus Robinhood Chain gas and any opening buy, all shown before you sign.";

export const INDEXER_NOTICE =
  "The contract is live on-chain. Market data will appear after external indexers discover trading activity.";

export const DEVNET_LAUNCH_NOTICE =
  "Launch is in testnet mode. Tokens created here have no mainnet market value.";

export const FAQ_ITEMS = [
  ["What does FONS do?", "FONS combines the character logic of two existing Robinhood Chain tokens, generates one editable token concept and launches it on Robinhood Chain. You can also skip AI and launch manually."],
  ["What does a launch cost?", ZERO_PLATFORM_FEE],
  ["Where does my token actually live?", "On Robinhood Chain. Your token is created by a public launch contract and trades on its own bonding curve until it graduates into a locked Uniswap v4 pool. FONS is the interface that builds the transaction; it never holds the token or the funds."],
  ["Why does the opening buy need a second signature?", "The launch contract requires the launch transaction to carry exactly the launch fee, so a buy cannot be bundled into it. Your token exists either way. If you skip or decline the second signature, the launch is still complete."],
  ["Does FONS hold my funds?", "No. FONS never asks for or holds your wallet's keys or funds. On a sponsored launch you do not connect a wallet at all; if you choose to pay it yourself, your own wallet signs and stays in control of its funds throughout."],
  ["Can AI launch a token without me?", "No. AI only produces editable creative fields. It cannot pick a launch path, edit a field or launch a token for you."],
  ["Can I launch without using AI?", "Yes. Direct Launch accepts your own name, ticker, description, image and links."],
  ["Can I edit the generated result?", "Yes. Every generated field is editable before metadata is pinned and the launch is sent."],
  ["Is a token launched here guaranteed to be safe?", "FONS protects the launch workflow by checking the factory holds code and simulating the transaction before anything is sent, whether Fons's wallet is paying or yours is. It cannot guarantee the future behaviour, market, holders, links or price of any token."],
  ["Does FONS guarantee profit?", "No. FONS does not provide investment advice or predict returns."],
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

export function shareLaunchCopy(input: {
  name: string;
  ticker: string;
  tradeUrl: string;
  parentA?: string;
  parentB?: string;
}): string {
  const title = `${input.name} ($${input.ticker})`;
  if (input.parentA && input.parentB) {
    return `${title} was born from ${input.parentA} + ${input.parentB} in FONS. ${input.tradeUrl}`;
  }
  return `${title} was born in FONS. ${input.tradeUrl}`;
}

/**
 * Where a token trades right after launch.
 *
 * A new launch lives on its Pons bonding curve, so DexScreener has nothing to
 * show until it graduates into a pool. Sending someone to an empty chart and
 * calling it "the market" would be a lie about their own token.
 */
export function ponsTokenUrl(token: string): string {
  return `https://www.ponsfamily.com/launchpad/${token}`;
}

/** The DEX chart, which only exists once the curve has graduated. */
export function marketUrl(token: string): string {
  return `https://dexscreener.com/robinhood/${token}`;
}

export function explorerTxUrl(hash: string): string {
  return `https://robinhoodchain.blockscout.com/tx/${hash}`;
}

export function explorerTokenUrl(address: string): string {
  return `https://robinhoodchain.blockscout.com/token/${address}`;
}
