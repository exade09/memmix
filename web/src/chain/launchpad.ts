import { decodeEventLog, type Address, type PublicClient, type WalletClient } from "viem";
import { LaunchError, mapSendFailure } from "./errors";
import { applyPercentBuffer, weiToEthLabel } from "./units";
import { TARGET_CHAIN_ID } from "./wallet";
import {
  DEFAULT_LAUNCH_CONFIG_ID,
  NATIVE_PAIR_TOKEN,
  PONS_CURVE_ABI,
  PONS_FACTORY_ABI,
  canLaunch,
  emptySocials,
  freshSalt,
  ponsFactoryAddress,
  readLaunchTerms,
  type PonsLaunchTerms,
  type PonsSocials,
} from "./pons";

/*
  Launching through Pons v2.

  This file used to describe a Fons launchpad that did not exist. It now drives
  the deployed Pons v2 factory, whose interface is published under MIT and whose
  live parameters were read off chain rather than assumed (see ./pons.ts).

  The order of operations is deliberate and unchanged in spirit from the Solana
  build: prove the contract is there, quote the real terms, simulate, and only
  then let a wallet be asked for a signature.
*/

export const METADATA_URI_MAX = 200;
export const COST_BUFFER_PERCENT = 10;

/** Kept as the public name for the factory this build launches through. */
export function launchpadAddress(): Address {
  return ponsFactoryAddress();
}

export type LaunchReadiness = {
  configured: boolean;
  reason: string;
};

/**
 * Whether a launch is possible at all.
 *
 * A configured address is no longer the question, since the Pons factory is a
 * known deployment. What remains is whether this build is allowed to use it.
 */
export function launchReadiness(): LaunchReadiness {
  if (!launchpadAddress()) {
    return { configured: false, reason: "No Pons factory address is configured for this build." };
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

/** Refuse to go further if the factory address holds no code on this network. */
export async function assertLaunchpadDeployed(client: PublicClient): Promise<Address> {
  const address = launchpadAddress();
  if (!address) {
    throw new LaunchError(launchReadiness().reason, "LAUNCHPAD_NOT_CONFIGURED");
  }
  const code = await client.getCode({ address });
  if (!code || code === "0x") {
    throw new LaunchError(
      "No contract found at the Pons factory address on this network.",
      "LAUNCHPAD_NOT_DEPLOYED",
    );
  }
  return address;
}

export type CostEstimate = {
  launchFeeWei: bigint;
  gasWei: bigint;
  initialBuyWei: bigint;
  maxDebitWei: bigint;
  bufferLabel: string;
};

type TokenParamsTuple = {
  name: string;
  symbol: string;
  logo: string;
  description: string;
  socials: PonsSocials;
  creatorFeeRecipient: Address;
  creatorTaxBps: number;
  buybackEnabled: boolean;
  expectedEconomics: `0x${string}`;
  salt: `0x${string}`;
};

export type PreparedLaunch = {
  address: Address;
  params: TokenParamsTuple;
  launchConfigId: bigint;
  pairToken: Address;
  /** Exactly launchFee. The factory reverts on any other value. */
  value: bigint;
  gas: bigint;
  terms: PonsLaunchTerms;
  /** Held back for a second transaction; it cannot ride along on the launch. */
  initialBuyWei: bigint;
  estimate: CostEstimate;
};

export type LaunchInput = {
  client: PublicClient;
  account: Address;
  name: string;
  symbol: string;
  metadataUri: string;
  initialBuyWei: bigint;
  description?: string;
  logo?: string;
  socials?: Partial<PonsSocials>;
  creatorTaxBps?: number;
  buybackEnabled?: boolean;
};

/**
 * Quote the real terms, then simulate.
 *
 * Every number the user is shown comes from the contract or the node: the fee
 * from `launchFee()`, the gas from the node's own estimate, the economics from
 * `previewLaunchEconomics`. Nothing here is a constant chosen to look good.
 */
export async function simulateLaunch(input: LaunchInput): Promise<PreparedLaunch> {
  const { client, account, name, symbol, metadataUri, initialBuyWei } = input;
  validateLaunchFields(name, symbol, metadataUri);
  const address = await assertLaunchpadDeployed(client);

  const terms = await readLaunchTerms(client, DEFAULT_LAUNCH_CONFIG_ID);
  if (!terms.launchEnabled || !terms.config.enabled) {
    throw new LaunchError("Pons has launching switched off right now.", "LAUNCH_DISABLED_ONCHAIN");
  }
  if (!(await canLaunch(client, account))) {
    throw new LaunchError("This wallet is not allowed to launch on Pons right now.", "LAUNCH_NOT_PERMITTED");
  }

  const params: TokenParamsTuple = {
    name: name.trim(),
    symbol: symbol.trim().toUpperCase(),
    logo: (input.logo || "").trim(),
    description: (input.description || "").trim(),
    socials: { ...emptySocials(), ...(input.socials || {}) },
    // address(0) means the factory uses the deployer, which is what we want:
    // the person signing keeps their own creator fees.
    creatorFeeRecipient: account,
    creatorTaxBps: input.creatorTaxBps ?? 0,
    buybackEnabled: input.buybackEnabled ?? false,
    // Pin the terms we just quoted. If an owner re-pegs between now and the
    // signature landing, the transaction reverts instead of repricing quietly.
    expectedEconomics: terms.economics,
    salt: freshSalt(),
  };

  const call = {
    address,
    abi: PONS_FACTORY_ABI,
    functionName: "launchToken",
    args: [params, DEFAULT_LAUNCH_CONFIG_ID, NATIVE_PAIR_TOKEN],
    value: terms.launchFeeWei,
    account,
  } as const;

  try {
    await client.simulateContract(call);
  } catch (error: unknown) {
    throw new LaunchError(
      error instanceof Error ? error.message : "Simulation failed.",
      "SIMULATION_FAILED",
    );
  }

  const gas = await client.estimateContractGas(call);
  const fees = await client.estimateFeesPerGas();
  const perGas = fees.maxFeePerGas ?? fees.gasPrice ?? 0n;
  const gasWei = gas * perGas;
  const maxDebitWei = applyPercentBuffer(gasWei + terms.launchFeeWei + initialBuyWei, COST_BUFFER_PERCENT);

  return {
    address,
    params,
    launchConfigId: DEFAULT_LAUNCH_CONFIG_ID,
    pairToken: NATIVE_PAIR_TOKEN,
    value: terms.launchFeeWei,
    gas,
    terms,
    initialBuyWei,
    estimate: {
      launchFeeWei: terms.launchFeeWei,
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
      launchFee: fallback,
      fonsFee: "0 ETH",
      gas: fallback,
      initialBuy: fallback,
      maxDebit: fallback,
    };
  }
  return {
    launchFee: weiToEthLabel(estimate.launchFeeWei),
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
      abi: PONS_FACTORY_ABI,
      functionName: "launchToken",
      args: [prepared.params, prepared.launchConfigId, prepared.pairToken],
      value: prepared.value,
      gas: prepared.gas,
      account,
      chain: null,
    });
  } catch (error: unknown) {
    throw mapSendFailure(error);
  }
}

export type ConfirmedLaunch = { hash: `0x${string}`; token: Address; curve: Address };

/**
 * A launch is confirmed when the receipt says success and the factory's own
 * TokenLaunched event is in it. The event carries the curve as well as the
 * token, and the curve is what the optional initial buy trades against.
 */
export async function confirmLaunch(
  client: PublicClient,
  hash: `0x${string}`,
): Promise<ConfirmedLaunch> {
  const receipt = await client.waitForTransactionReceipt({ hash, confirmations: 1, timeout: 120_000 });
  if (receipt.status !== "success") {
    throw new LaunchError("The launch transaction reverted. No token was created.", "LAUNCH_REVERTED");
  }

  const factory = launchpadAddress().toLowerCase();
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== factory) continue;
    try {
      const decoded = decodeEventLog({ abi: PONS_FACTORY_ABI, data: log.data, topics: log.topics });
      if (decoded.eventName !== "TokenLaunched") continue;
      const args = decoded.args as unknown as { token: Address; curve: Address };
      return { hash, token: args.token, curve: args.curve };
    } catch {
      // A log from the factory we do not decode is not the one we need.
    }
  }

  throw new LaunchError(
    "The transaction succeeded but no TokenLaunched event was found in the receipt.",
    "LAUNCH_NOT_CONFIRMED",
  );
}

/**
 * The optional opening buy, as its own transaction.
 *
 * It cannot be part of the launch: `_launchToken` requires msg.value to equal
 * launchFee exactly. The creator is auto-exempt from the snipe tax, so buying
 * in a second transaction costs them nothing extra beyond gas.
 */
export async function submitInitialBuy(
  wallet: WalletClient,
  client: PublicClient,
  account: Address,
  curve: Address,
  amountWei: bigint,
): Promise<`0x${string}`> {
  if (amountWei <= 0n) {
    throw new LaunchError("No initial buy amount was set.", "INVALID_INPUT");
  }
  const call = {
    address: curve,
    abi: PONS_CURVE_ABI,
    functionName: "buy",
    // minTokensOut 0 is safe here and only here: this is the creator's own
    // opening buy on a curve that nobody else has traded yet, in the same
    // block window, and they are exempt from the snipe tax.
    args: [amountWei, 0n, account],
    value: amountWei,
    account,
  } as const;
  try {
    await client.simulateContract(call);
    return await wallet.writeContract({ ...call, chain: null });
  } catch (error: unknown) {
    throw mapSendFailure(error);
  }
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
