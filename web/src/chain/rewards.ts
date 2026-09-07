import type { Address, PublicClient, WalletClient } from "viem";

/*
  Talking to the rewards distributor.

  Only the functions the site actually calls are declared. The proof and
  amount come from the server, but nothing here has to trust them: the
  contract verifies the proof against the root it already holds, so a wrong
  amount or a forged proof simply reverts rather than paying anything out.

  createRound is the one owner-only call, used by the admin page. It funds
  the round in the same transaction it publishes it, so a round can never be
  announced without the money behind it.
*/

export const REWARDS_DISTRIBUTOR_ABI = [
  {
    type: "function",
    name: "claim",
    stateMutability: "nonpayable",
    inputs: [
      { name: "roundId", type: "uint256" },
      { name: "index", type: "uint256" },
      { name: "account", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "proof", type: "bytes32[]" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "isClaimed",
    stateMutability: "view",
    inputs: [
      { name: "roundId", type: "uint256" },
      { name: "index", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "roundCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "createRound",
    stateMutability: "payable",
    inputs: [
      { name: "asset", type: "address" },
      { name: "merkleRoot", type: "bytes32" },
      { name: "total", type: "uint256" },
      { name: "snapshotBlock", type: "uint256" },
      { name: "expiresAt", type: "uint64" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "owner",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
] as const;

export const NATIVE_ASSET = "0x0000000000000000000000000000000000000000" as Address;

export function isNativeAsset(asset: string): boolean {
  return !asset || asset.toLowerCase() === NATIVE_ASSET;
}

export function rewardsDistributorAddress(): Address | null {
  const raw = (import.meta.env.VITE_REWARDS_DISTRIBUTOR_ADDRESS ?? "").trim();
  return /^0x[a-fA-F0-9]{40}$/.test(raw) ? (raw as Address) : null;
}

export type ClaimInput = {
  roundId: bigint;
  index: bigint;
  account: Address;
  amount: bigint;
  proof: `0x${string}`[];
};

/** Whether this entry has already been taken, asked of the chain, not the server. */
export async function isClaimed(
  client: PublicClient,
  distributor: Address,
  roundId: bigint,
  index: bigint,
): Promise<boolean> {
  return (await client.readContract({
    address: distributor,
    abi: REWARDS_DISTRIBUTOR_ABI,
    functionName: "isClaimed",
    args: [roundId, index],
  })) as boolean;
}

/**
 * Claim one entry.
 *
 * Simulated first so a claim that would revert -- already taken, bad proof,
 * expired round -- fails before a wallet ever opens, rather than costing the
 * holder gas to find out.
 */
export async function submitClaim(
  wallet: WalletClient,
  client: PublicClient,
  distributor: Address,
  account: Address,
  input: ClaimInput,
): Promise<`0x${string}`> {
  const call = {
    address: distributor,
    abi: REWARDS_DISTRIBUTOR_ABI,
    functionName: "claim",
    args: [input.roundId, input.index, input.account, input.amount, input.proof],
    account,
  } as const;

  await client.simulateContract(call);
  return await wallet.writeContract({ ...call, chain: null });
}

/** Who may create rounds. The admin page checks this before offering to. */
export async function readDistributorOwner(
  client: PublicClient,
  distributor: Address,
): Promise<Address> {
  return (await client.readContract({
    address: distributor,
    abi: REWARDS_DISTRIBUTOR_ABI,
    functionName: "owner",
  })) as Address;
}

/** How many rounds exist. The next one created gets this id. */
export async function readRoundCount(
  client: PublicClient,
  distributor: Address,
): Promise<bigint> {
  return (await client.readContract({
    address: distributor,
    abi: REWARDS_DISTRIBUTOR_ABI,
    functionName: "roundCount",
  })) as bigint;
}

export type CreateRoundInput = {
  asset: Address;
  merkleRoot: `0x${string}`;
  total: bigint;
  snapshotBlock: bigint;
  expiresAt: bigint;
};

/**
 * Publish and fund a round, and report the id it was given.
 *
 * The id is read back from the receipt rather than from roundCount before
 * the send: two rounds created close together would otherwise both be filed
 * under the same id, and the payout table would be attached to the wrong one.
 *
 * Simulated first, so a wrong asset, a short balance or a missing approval
 * fails before the wallet opens instead of costing gas to discover.
 */
export async function submitCreateRound(
  wallet: WalletClient,
  client: PublicClient,
  distributor: Address,
  account: Address,
  input: CreateRoundInput,
): Promise<{ hash: `0x${string}`; roundId: number }> {
  const call = {
    address: distributor,
    abi: REWARDS_DISTRIBUTOR_ABI,
    functionName: "createRound",
    args: [input.asset, input.merkleRoot, input.total, input.snapshotBlock, input.expiresAt],
    account,
    value: isNativeAsset(input.asset) ? input.total : 0n,
  } as const;

  const { result } = await client.simulateContract(call);
  const hash = await wallet.writeContract({ ...call, chain: null });
  const receipt = await client.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error("The round transaction reverted.");
  return { hash, roundId: Number(result as bigint) };
}
