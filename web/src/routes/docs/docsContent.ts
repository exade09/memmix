/*
  What the documentation says.

  Kept as data rather than markup so the page renders it uniformly and so
  every claim sits in one place where it can be checked against the code.
  Nothing here is aspirational: each figure is either read live from the
  contract at runtime or was read off chain before being written down.
*/

export type DocBlock =
  | { kind: "text"; body: string }
  | { kind: "steps"; items: [string, string][] }
  | { kind: "facts"; items: [string, string][] }
  | { kind: "list"; items: string[] }
  | { kind: "note"; body: string };

export type DocSection = {
  id: string;
  title: string;
  lede: string;
  blocks: DocBlock[];
};

export const DOC_SECTIONS: DocSection[] = [
  {
    id: "what",
    title: "What Fons does",
    lede: "Two tokens go in. One new one comes out, built from what makes both of them work.",
    blocks: [
      {
        kind: "text",
        body:
          "Most tokens are made by copying something that already moved and changing a few letters. Fons takes a different route: you pick two tokens that already exist on Robinhood Chain, and it reads the character of each one and combines them into a single new concept. Not a name glued to a name — the logic underneath.",
      },
      {
        kind: "steps",
        items: [
          ["Pick two", "Search the live feed by name, ticker or contract address. The two have to be different."],
          ["Get three concepts", "The mix returns three, and marks the one it would choose. You pick before any image is made."],
          ["Generate one avatar", "One square image for the concept you chose."],
          ["Edit anything", "Name, ticker, description, links and image are all yours to change before a wallet ever opens."],
          ["Launch", "The transaction is built, checked and simulated. You sign it in MetaMask."],
        ],
      },
      {
        kind: "note",
        body:
          "You can skip the AI entirely. Direct Launch takes your own name, ticker, description and image and goes straight to the chain. If every model Fons uses went down, that half still works.",
      },
    ],
  },
  {
    id: "ai",
    title: "What the AI produces",
    lede: "Exactly four things, and not one more.",
    blocks: [
      {
        kind: "facts",
        items: [
          ["Name", "2 to 32 characters"],
          ["Ticker", "1 to 6 letters or numbers"],
          ["Description", "1 to 500 characters"],
          ["Avatar", "one square 1024×1024 image"],
        ],
      },
      {
        kind: "text",
        body:
          "There is no thread generator, no roadmap, no tokenomics, no token site. Everything the model writes is editable, and nothing it produces can open your wallet or sign anything.",
      },
      {
        kind: "note",
        body:
          "If the text model is unavailable the mix still runs, on a deterministic fallback that is labelled as such on screen. Fons never presents a fallback as AI output.",
      },
    ],
  },
  {
    id: "chain",
    title: "The chain",
    lede: "Robinhood Chain, an Arbitrum Orbit L2. Gas is paid in ETH.",
    blocks: [
      {
        kind: "facts",
        items: [
          ["Network", "Robinhood Chain"],
          ["Chain ID", "4663"],
          ["Gas token", "ETH"],
          ["Wallet", "MetaMask"],
          ["Explorer", "robinhoodchain.blockscout.com"],
        ],
      },
      {
        kind: "text",
        body:
          "Fons never connects your wallet on its own. Nothing is requested until you press connect, and if you are on another network it offers to switch, or to add the network if your wallet does not know it yet.",
      },
      {
        kind: "note",
        body:
          "Every read goes through the Fons proxy rather than straight to a public node. The proxy carries reads only: no method that can send or sign a transaction is on its allowlist, so no setting can turn one on. Signing happens in your wallet and never touches the server.",
      },
    ],
  },
  {
    id: "cost",
    title: "What a launch costs",
    lede: "Fons adds no fee of its own. That is not the same as free.",
    blocks: [
      {
        kind: "facts",
        items: [
          ["Fons fee", "0 ETH"],
          ["Launch contract fee", "0.0005 ETH"],
          ["Gas", "about 0.0019 ETH"],
          ["Typical total", "about 0.0021 ETH"],
        ],
      },
      {
        kind: "text",
        body:
          "The launch deploys two contracts, your token and its curve, which is why gas is the larger half of the bill. Every figure above is read live from the chain and shown on the review screen before MetaMask opens; the numbers here are what it looked like when this page was written.",
      },
      {
        kind: "note",
        body:
          "Your wallet reserves the maximum a transaction could cost, not what it ends up costing, and refunds the difference. Keep about 0.003 ETH on the account so a small rise in the base fee cannot strand the launch.",
      },
    ],
  },
  {
    id: "trading",
    title: "How the token trades",
    lede: "Every launch starts on its own bonding curve.",
    blocks: [
      {
        kind: "text",
        body:
          "The full supply is minted to the curve at launch. Earlier buyers pay less and the price rises with demand. When the curve fills, liquidity moves into a locked pool and the token trades like anything else. Nobody gets a private entrance, an allocation or a list.",
      },
      {
        kind: "note",
        body:
          "Until it graduates there is no chart on DexScreener, because there is no pool yet. That is why the success page sends you to the curve first.",
      },
    ],
  },
  {
    id: "buy",
    title: "The opening buy",
    lede: "Optional, off by default, and always a second signature.",
    blocks: [
      {
        kind: "text",
        body:
          "The launch contract requires the launch transaction to carry exactly the launch fee, so a purchase cannot ride along inside it. If you set an opening buy, Fons sends it as its own transaction against the curve, after the launch is confirmed and recorded.",
      },
      {
        kind: "list",
        items: [
          "Your token exists whether or not the second signature happens.",
          "Declining or skipping the buy never reads as a failed launch.",
          "The buy is simulated first and floored at the curve's own quoted amount minus 5%, so it reverts rather than filling at a price someone else moved.",
        ],
      },
    ],
  },
  {
    id: "safety",
    title: "What Fons checks before you sign",
    lede: "In this order, every time.",
    blocks: [
      {
        kind: "steps",
        items: [
          ["The contract is real", "The launch contract address is checked for bytecode. No code, no signature request."],
          ["The terms are current", "Fee and economics are read live and pinned, so a change between quoting and signing reverts instead of silently repricing."],
          ["The transaction simulates", "The whole launch is run against the chain first. A failed simulation disables signing."],
          ["The cost is shown", "Fee, gas and any opening buy, with the maximum debit, before the wallet opens."],
        ],
      },
      {
        kind: "note",
        body:
          "If a send comes back unknown, Fons stops. It checks the chain, tells you what it found and waits for you. It will never quietly build a second token.",
      },
    ],
  },
  {
    id: "honesty",
    title: "What Fons will not tell you",
    lede: "The gaps are on purpose.",
    blocks: [
      {
        kind: "list",
        items: [
          "When a value cannot be read, the field says unknown. There is no invented volume and no placeholder holder count.",
          "A similar-name check is informational. It never blocks a launch and it is not a trademark search.",
          "Fons is non-custodial. Your keys stay in your wallet and there is no version of this where Fons can move your token.",
          "Nothing here is a promise of price, liquidity, a listing or a market. Token creation and trading are risky.",
        ],
      },
    ],
  },
];

export const DOC_META = {
  eyebrow: "Documentation",
  title: ["How Fons works"],
  lede: "Everything the product actually does, in the order you meet it.",
};
