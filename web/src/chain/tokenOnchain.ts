import { erc20Abi, type Address, type PublicClient } from "viem";
import { normalizeAddress } from "./address";

/*
  Reading a token straight from the chain, so the page never depends on an
  indexer to say whether something exists.

  The Solana build had to prove an account was owned by the Token Program
  before calling it a token. The equivalent here is stricter and simpler: an
  address is a token only if it holds code and answers the ERC-20 calls.
  An EOA, or a contract that is not a token, is reported as not found.
*/

export type OnchainTokenView = {
  exists: boolean;
  address: string;
  name: string | null;
  symbol: string | null;
  decimals: number | null;
  totalSupply: bigint | null;
};

export async function readOnchainToken(
  client: PublicClient,
  rawAddress: string,
): Promise<OnchainTokenView> {
  const address = normalizeAddress(rawAddress);
  const empty: OnchainTokenView = {
    exists: false,
    address: rawAddress,
    name: null,
    symbol: null,
    decimals: null,
    totalSupply: null,
  };
  if (!address) return empty;

  const code = await client.getCode({ address: address as Address });
  if (!code || code === "0x") return { ...empty, address };

  const results = await client.multicall({
    contracts: [
      { address: address as Address, abi: erc20Abi, functionName: "name" },
      { address: address as Address, abi: erc20Abi, functionName: "symbol" },
      { address: address as Address, abi: erc20Abi, functionName: "decimals" },
      { address: address as Address, abi: erc20Abi, functionName: "totalSupply" },
    ],
    allowFailure: true,
  });

  const [name, symbol, decimals, supply] = results;
  // Code alone is not a token; it has to answer like one.
  const looksLikeToken = symbol.status === "success" && decimals.status === "success";

  return {
    exists: looksLikeToken,
    address,
    name: name.status === "success" ? (name.result as string) : null,
    symbol: symbol.status === "success" ? (symbol.result as string) : null,
    decimals: decimals.status === "success" ? Number(decimals.result) : null,
    totalSupply: supply.status === "success" ? (supply.result as bigint) : null,
  };
}
