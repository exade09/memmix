import { defineChain } from "viem";

/*
  Robinhood Chain.

  An Arbitrum Orbit L2 running Arbitrum Nitro, EVM-equivalent, gas paid in
  ETH. Parameters are the published ones rather than anything invented: a
  wrong chain id here would ask MetaMask to add the wrong network, which is
  not a mistake worth risking.

  Mainnet is the read default, because it is the only endpoint Robinhood has
  published; VITE_ROBINHOOD_TESTNET=true switches to 46630. That default is
  not the safety boundary. Launching is gated separately and independently:
  a configured launchpad address, ENABLE_NATIVE_LAUNCH, and on mainnet
  ENABLE_MAINNET_LAUNCH. Reading a public chain costs nothing and signs
  nothing.
*/

export const ROBINHOOD_MAINNET_ID = 4663;
export const ROBINHOOD_TESTNET_ID = 46630;

const MAINNET_RPC = "https://rpc.mainnet.chain.robinhood.com";
const MAINNET_EXPLORER = "https://robinhoodchain.blockscout.com";

export const robinhoodMainnet = defineChain({
  id: ROBINHOOD_MAINNET_ID,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: [MAINNET_RPC] },
  },
  blockExplorers: {
    default: { name: "Blockscout", url: MAINNET_EXPLORER },
  },
});

export const robinhoodTestnet = defineChain({
  id: ROBINHOOD_TESTNET_ID,
  name: "Robinhood Chain Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: [MAINNET_RPC] },
  },
  blockExplorers: {
    default: { name: "Blockscout", url: MAINNET_EXPLORER },
  },
  testnet: true,
});

export function chainFor(id: number) {
  return id === ROBINHOOD_MAINNET_ID ? robinhoodMainnet : robinhoodTestnet;
}

export function explorerTxUrl(hash: string, chainId: number): string {
  return `${chainFor(chainId).blockExplorers.default.url}/tx/${hash}`;
}

export function explorerAddressUrl(address: string, chainId: number): string {
  return `${chainFor(chainId).blockExplorers.default.url}/address/${address}`;
}

export function chainLabel(id: number): string {
  return id === ROBINHOOD_MAINNET_ID ? "ROBINHOOD CHAIN" : "ROBINHOOD TESTNET";
}
