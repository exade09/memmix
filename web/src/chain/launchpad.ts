import type { Address, PublicClient, WalletClient } from "viem";
import { LaunchError, mapSendFailure } from "./errors";
import { applyPercentBuffer, weiToEthLabel } from "./units";
import { normalizeAddress } from "./address";
import { TARGET_CHAIN_ID } from "./wallet";

/*
  The Fons launchpad on Robinhood Chain.

  IMPORTANT: the ABI below is the shape this client expects, not a contract
  that has been verified to exist. Until VITE_FONS_LAUNCHPAD_ADDRESS points at
  a deployed launchpad, `launchReadiness` reports it as unconfigured and no
  transaction is ever built.

  Even once an address is set, `assertLaunchpadDeployed` fetches the bytecode
  first and refuses to continue if the address holds no code. A wallet is never
  asked to sign against an address we have not confirmed is a contract.
*/

export const LAUNCHPAD_ABI = [
  {
    type: "function",
    name: "createToken",
    stateMutability: "payable",
    inputs: [
      { name: "name", type: "string" },
      { name: "symbol", type: "string" },
      { name: "metadataURI", type: "string" },
    ],
    outputs: [{ name: "token", type: "address" }],
  },
  {
    type: "event",
    name: "TokenCreated",
    inputs: [
      { name: "token", type: "address", indexed: true },
      { name: "creator", type: "address", indexed: true },
      { name: "metadataURI", type: "string", indexed: false },
    ],
  },
] as const;

export const METADATA_URI_MAX = 200;
export const COST_BUFFER_PERCENT = 10;

export function launchpadAddress(): Address | null {
  const raw = import.meta.env.VITE_FONS_LAUNCHPAD_ADDRESS ?? "";
  const normalized = normalizeAddress(raw);
  return normalized ? (normalized as Address) : null;
}

export type LaunchReadiness = {
  configured: boolean;
  reason: string;
};

/** Why the launch path is or is not usable, in words a user can act on. */
export function launchReadiness(): LaunchReadiness {
  if (!launchpadAddress()) {
    return {
      configured: false,
      reason: "The Fons launchpad contract is not connected yet, so nothing can be signed.",
    };
  }
  return { configured: true, reason: "Ready to build a launch transaction." };
}

export function validateLaunchFields(name: string, symbol: string, uri: string): void {
  if (name.trim().length < 2 || name.trim().length > 32) {
    throw new LaunchError("Name must be 2 to 32 characters.", "INVALID_INPUT");
  }
  if (!/^[A-Za-z0-9]{1,6}$/.test(symbol.trim())) {
    throw new LaunchError("Ticker must be 1 to 6 letters or numbers.", "INVALID_INPUT");
  }
  if (!uri || uri.length > METADATA_URI_MAX) {
    throw new LaunchError("Metadata URI is missing or too long.", "INVALID_INPUT");
  }
}

/** Refuse to go further if the configured address is not actually a contract. */
export async function assertLaunchpadDeployed(client: PublicClient): Promise<Address> {
  const address = launchpadAddress();
  if (!address) {
    throw new LaunchError(launchReadiness().reason, "LAUNCHPAD_NOT_CONFIGURED");
  }
  const code = await client.getCode({ address });
  if (!code || code === "0x") {
    throw new LaunchError(
      "No contract found at the configured launchpad address on this network.",
      "LAUNCHPAD_NOT_DEPLOYED",
    );
  }
  return address;
}

export type CostEstimate = {
  gasWei: bigint;
  initialBuyWei: bigint;
  maxDebitWei: bigint;
  bufferLabel: string;
};

export type PreparedLaunch = {
  address: Address;
  args: readonly [string, string, string];
  value: bigint;
  gas: bigint;
  estimate: CostEstimate;
};

/**
 * Simulate first, quote second. The number shown to the user comes from the
 * node's own estimate plus a stated buffer, never from a marketing constant.
 */
export async function simulateLaunch(input: {
  client: PublicClient;
  account: Address;
  name: string;
  symbol: string;
  metadataUri: string;
  initialBuyWei: bigint;
}): Promise<PreparedLaunch> {
  const { client, account, name, symbol, metadataUri, initialBuyWei } = input;
  validateLaunchFields(name, symbol, metadataUri);
  const address = await assertLaunchpadDeployed(client);
  const args = [name.trim(), symbol.trim().toUpperCase(), metadataUri] as const;

  try {
    await client.simulateContract({
      address,
      abi: LAUNCHPAD_ABI,
      functionName: "createToken",
      args,
      value: initialBuyWei,
      account,
    });
  } catch (error: unknown) {
    throw new LaunchError(
      error instanceof Error ? error.message : "Simulation failed.",
      "SIMULATION_FAILED",
    );
  }

  const gas = await client.estimateContractGas({
    address,
    abi: LAUNCHPAD_ABI,
    functionName: "createToken",
    args,
    value: initialBuyWei,
    account,
  });
  const fees = await client.estimateFeesPerGas();
  const perGas = fees.maxFeePerGas ?? fees.gasPrice ?? 0n;
  const gasWei = gas * perGas;
  const maxDebitWei = applyPercentBuffer(gasWei + initialBuyWei, COST_BUFFER_PERCENT);

  return {
    address,
    args,
    value: initialBuyWei,
    gas,
    estimate: {
      gasWei,
      initialBuyWei,
      maxDebitWei,
      bufferLabel: `Includes a ${COST_BUFFER_PERCENT}% buffer over the estimate.`,
    },
  };
}

export function formatCost(estimate: CostEstimate | null, fallback: string) {
  if (!estimate) {
    return {
      launchFee: "0 ETH",
      fonsFee: "0 ETH",
      gas: fallback,
      initialBuy: fallback,
      maxDebit: fallback,
    };
  }
  return {
    launchFee: "0 ETH",
    fonsFee: "0 ETH",
    gas: weiToEthLabel(estimate.gasWei),
    initialBuy: weiToEthLabel(estimate.initialBuyWei),
    maxDebit: weiToEthLabel(estimate.maxDebitWei),
  };
}

export async function submitLaunch(
  wallet: WalletClient,
  account: Address,
  prepared: PreparedLaunch,
): Promise<`0x${string}`> {
  try {
    return await wallet.writeContract({
      address: prepared.address,
      abi: LAUNCHPAD_ABI,
      functionName: "createToken",
      args: prepared.args,
      value: prepared.value,
      gas: prepared.gas,
      account,
      chain: null,
    });
  } catch (error: unknown) {
    throw mapSendFailure(error);
  }
}

export type ConfirmedLaunch = { hash: `0x${string}`; token: Address };

/**
 * A launch is confirmed when the receipt says success and the created token
 * address can be read back out of it. A pending or reverted receipt is never
 * reported as success.
 */
export async function confirmLaunch(
  client: PublicClient,
  hash: `0x${string}`,
): Promise<ConfirmedLaunch> {
  const receipt = await client.waitForTransactionReceipt({ hash, confirmations: 1, timeout: 120_000 });
  if (receipt.status !== "success") {
    throw new LaunchError("The launch transaction reverted. No token was created.", "LAUNCH_REVERTED");
  }
  const created = receipt.logs.find((log) => log.address.toLowerCase() === launchpadAddress()?.toLowerCase());
  const token = (created?.topics?.[1] ? `0x${created.topics[1].slice(-40)}` : null) as Address | null;
  if (!token) {
    throw new LaunchError(
      "The transaction succeeded but no token address was found in the receipt.",
      "LAUNCH_NOT_CONFIRMED",
    );
  }
  return { hash, token };
}

export type ReconcileDecision = "confirmed" | "wait" | "rebuild" | "failed";

/** Same contract as the Solana build: never assume, never auto-duplicate. */
export function reconcileLaunch(input: {
  hash: string | null;
  receiptStatus: "success" | "reverted" | "pending" | "unknown" | null;
  tokenExists: boolean;
}): ReconcileDecision {
  if (!input.hash) return "rebuild";
  if (input.receiptStatus === "success" && input.tokenExists) return "confirmed";
  if (input.receiptStatus === "reverted") return "rebuild";
  if (input.receiptStatus === "pending" || input.receiptStatus === "unknown") return "wait";
  return "failed";
}

let submitting = false;

export function acquireLaunchSubmit(): boolean {
  if (submitting) return false;
  submitting = true;
  return true;
}

export function releaseLaunchSubmit(): void {
  submitting = false;
}

export function launchChainId(): number {
  return TARGET_CHAIN_ID;
}
