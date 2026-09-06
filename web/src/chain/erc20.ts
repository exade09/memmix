import type { Address, PublicClient, WalletClient } from "viem";

/*
  The little bit of ERC-20 a stock-paired launch needs.

  An ETH-paired curve is bought by attaching value to the call. A curve paired
  with a tokenized stock cannot work that way: the buyer has to hold that
  stock, approve the curve to move it, and then buy with no value attached.
  That approval step is the whole reason this file exists.
*/

export const ERC20_ABI = [
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "name", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
] as const;

export async function readErc20Decimals(client: PublicClient, token: Address): Promise<number> {
  const decimals = await client.readContract({ address: token, abi: ERC20_ABI, functionName: "decimals" });
  return Number(decimals);
}

export async function readErc20Balance(
  client: PublicClient,
  token: Address,
  owner: Address,
): Promise<bigint> {
  return (await client.readContract({
    address: token,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [owner],
  })) as bigint;
}

export async function readErc20Allowance(
  client: PublicClient,
  token: Address,
  owner: Address,
  spender: Address,
): Promise<bigint> {
  return (await client.readContract({
    address: token,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: [owner, spender],
  })) as bigint;
}

/**
 * Approve exactly what this purchase needs, not an unlimited allowance.
 *
 * An infinite approval is the convenient version and the one that keeps
 * paying out if the spender is ever compromised. The amount is known here, so
 * there is no reason to grant more than it.
 */
export async function approveErc20(
  wallet: WalletClient,
  account: Address,
  token: Address,
  spender: Address,
  amount: bigint,
): Promise<`0x${string}`> {
  return await wallet.writeContract({
    address: token,
    abi: ERC20_ABI,
    functionName: "approve",
    args: [spender, amount],
    account,
    chain: null,
  });
}

/** Format a raw token amount for display, without inventing precision. */
export function formatTokenAmount(amount: bigint, decimals: number, maxFractionDigits = 4): string {
  const base = 10n ** BigInt(decimals);
  const whole = amount / base;
  const fraction = amount % base;
  if (fraction === 0n) return whole.toString();
  const padded = fraction.toString().padStart(decimals, "0").slice(0, maxFractionDigits).replace(/0+$/, "");
  return padded ? `${whole}.${padded}` : whole.toString();
}

/** Parse a decimal string into base units for a token of the given decimals. */
export function parseTokenAmount(value: string, decimals: number): bigint {
  const trimmed = (value || "").trim();
  if (!trimmed) return 0n;
  if (!/^\d*\.?\d*$/.test(trimmed)) return 0n;
  const [wholePart = "0", fractionPart = ""] = trimmed.split(".");
  const fraction = fractionPart.slice(0, decimals).padEnd(decimals, "0");
  return BigInt(wholePart || "0") * 10n ** BigInt(decimals) + BigInt(fraction || "0");
}
