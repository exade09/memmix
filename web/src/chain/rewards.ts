import type { Address, PublicClient, WalletClient } from "viem";

/*
  Claiming from the rewards distributor.

  Only the three functions the site actually calls are declared. The proof
  and amount come from the server, but nothing here has to trust them: the
  contract verifies the proof against the root it already holds, so a wrong
  amount or a forged proof simply reverts rather than paying anything out.
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
] as const;

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
