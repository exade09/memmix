import BN from "bn.js";
import {
  BONDING_CURVE_NEW_SIZE,
  OnlinePumpSdk,
  PUMP_SDK,
  bondingCurvePda,
  getBuyTokenAmountFromSolAmount,
  type Global,
} from "@pump-fun/pump-sdk";
import { NATIVE_MINT, getTokenMetadata } from "@solana/spl-token";
import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
  type TransactionInstruction,
} from "@solana/web3.js";
import { applyPercentBuffer, lamportsToSolLabel } from "./lamports";
import { LaunchError, isInsufficientBalance, isStaleBlockhash, isWalletRejection, mapSendFailure } from "./launchErrors";
import { assertLaunchPrograms, unexpectedPrograms } from "./programAllowlist";

export const METADATA_URI_MAX = 200;
export const SLIPPAGE_BPS = 100;
export const COMPUTE_UNIT_LIMIT = 400_000;
export const COST_BUFFER_PERCENT = 10;

export type CostEstimate = {
  pumpCreationLamports: bigint;
  mixbornFeeLamports: bigint;
  networkFeeLamports: bigint;
  rentLamports: bigint;
  initialBuyLamports: bigint;
  bufferLamports: bigint;
  maxDebitLamports: bigint;
  bufferLabel: string;
};

export type PreparedLaunchTx = {
  transaction: VersionedTransaction;
  blockhash: string;
  lastValidBlockHeight: number;
  programIds: string[];
  mint: PublicKey;
  user: PublicKey;
  uri: string;
  initialBuyLamports: bigint;
  estimate: CostEstimate;
};

export type LaunchWallet = {
  publicKey: PublicKey;
  signTransaction: (transaction: VersionedTransaction) => Promise<VersionedTransaction>;
};

export type ConfirmResult = {
  signature: string;
  mint: string;
};

export function validateLaunchFields(name: string, symbol: string, uri: string): void {
  if (name.trim().length < 1 || name.trim().length > 32) {
    throw new LaunchError("INVALID_INPUT", "Name must be 1–32 characters for create_v2.");
  }
  if (symbol.trim().length < 1 || symbol.trim().length > 6) {
    throw new LaunchError("INVALID_INPUT", "Ticker must be 1–6 characters.");
  }
  if (!uri.startsWith("https://")) {
    throw new LaunchError("INVALID_INPUT", "Metadata URI must be HTTPS.");
  }
  if (uri.length > METADATA_URI_MAX) {
    throw new LaunchError("METADATA_URI_TOO_LONG", "Metadata URI exceeds the Pump 200-character limit.");
  }
}

export async function buildLaunchInstructions(input: {
  mint: PublicKey;
  name: string;
  symbol: string;
  uri: string;
  user: PublicKey;
  initialBuyLamports: bigint;
  global?: Global | null;
}): Promise<TransactionInstruction[]> {
  validateLaunchFields(input.name, input.symbol, input.uri);
  if (input.global && input.global.createV2Enabled === false) {
    throw new LaunchError("CREATE_V2_DISABLED", "create_v2 is disabled on this cluster. Launch stopped.");
  }
  if (input.initialBuyLamports === 0n) {
    const createIx = await PUMP_SDK.createV2Instruction({
      mint: input.mint,
      name: input.name.trim(),
      symbol: input.symbol.trim(),
      uri: input.uri,
      creator: input.user,
      user: input.user,
      mayhemMode: false,
      cashback: false,
    });
    return [ComputeBudgetProgram.setComputeUnitLimit({ units: COMPUTE_UNIT_LIMIT }), createIx];
  }
  if (!input.global) {
    throw new LaunchError("RPC_UNAVAILABLE", "Initial buy needs the on-chain Pump global account.");
  }
  const solAmount = new BN(input.initialBuyLamports.toString());
  const tokenAmount = getBuyTokenAmountFromSolAmount({
    global: input.global,
    feeConfig: null,
    mintSupply: null,
    bondingCurve: null,
    amount: solAmount,
    quoteMint: NATIVE_MINT,
  });
  const quoteAmount = solAmount.muln(100 + SLIPPAGE_BPS / 100).divn(100);
  const ixs = await PUMP_SDK.createV2AndBuyV2Instructions({
    global: input.global,
    mint: input.mint,
    name: input.name.trim(),
    symbol: input.symbol.trim(),
    uri: input.uri,
    creator: input.user,
    user: input.user,
    amount: tokenAmount,
    quoteAmount,
    mayhemMode: false,
    cashback: false,
  });
  return [ComputeBudgetProgram.setComputeUnitLimit({ units: COMPUTE_UNIT_LIMIT }), ...ixs];
}

export function instructionProgramIds(instructions: TransactionInstruction[]): string[] {
  return instructions.map((ix) => ix.programId.toBase58());
}

export function compiledProgramIds(transaction: VersionedTransaction): string[] {
  const keys = transaction.message.staticAccountKeys;
  return transaction.message.compiledInstructions.map((ix) => keys[ix.programIdIndex].toBase58());
}

export function partialSignMint(transaction: VersionedTransaction, mint: Keypair): VersionedTransaction {
  transaction.sign([mint]);
  return transaction;
}

export function mintSignaturePresent(transaction: VersionedTransaction, mint: PublicKey): boolean {
  const index = transaction.message.staticAccountKeys.findIndex((key) => key.equals(mint));
  if (index < 0) return false;
  const signature = transaction.signatures[index];
  return Boolean(signature && signature.some((byte) => byte !== 0));
}

export async function fetchLaunchGlobal(connection: Connection): Promise<Global> {
  try {
    const sdk = new OnlinePumpSdk(connection);
    const global = await sdk.fetchGlobal();
    if (global.createV2Enabled === false) {
      throw new LaunchError("CREATE_V2_DISABLED", "create_v2 is disabled on this cluster. Launch stopped.");
    }
    return global;
  } catch (error) {
    if (error instanceof LaunchError) throw error;
    throw new LaunchError("RPC_UNAVAILABLE", "The Solana RPC is unavailable.");
  }
}

export async function compileLaunchTransaction(input: {
  connection: Connection;
  instructions: TransactionInstruction[];
  payer: PublicKey;
  mint: Keypair;
  uri: string;
  initialBuyLamports: bigint;
}): Promise<PreparedLaunchTx> {
  const programIds = instructionProgramIds(input.instructions);
  const unexpected = unexpectedPrograms(programIds);
  if (unexpected.length) {
    throw new LaunchError(
      "UNEXPECTED_PROGRAM",
      `Unexpected program in transaction: ${unexpected.join(", ")}. Sign is disabled.`,
    );
  }
  assertLaunchPrograms(programIds);
  const latest = await input.connection.getLatestBlockhash("confirmed");
  const message = new TransactionMessage({
    payerKey: input.payer,
    recentBlockhash: latest.blockhash,
    instructions: input.instructions,
  }).compileToV0Message();
  const transaction = new VersionedTransaction(message);
  partialSignMint(transaction, input.mint);
  const compiled = compiledProgramIds(transaction);
  const compiledUnexpected = unexpectedPrograms(compiled);
  if (compiledUnexpected.length) {
    throw new LaunchError(
      "UNEXPECTED_PROGRAM",
      `Unexpected program in transaction: ${compiledUnexpected.join(", ")}. Sign is disabled.`,
    );
  }
  if (!mintSignaturePresent(transaction, input.mint.publicKey)) {
    throw new LaunchError("INVALID_INPUT", "Mint partial signature is missing.");
  }
  return {
    transaction,
    blockhash: latest.blockhash,
    lastValidBlockHeight: latest.lastValidBlockHeight,
    programIds: compiled,
    mint: input.mint.publicKey,
    user: input.payer,
    uri: input.uri,
    initialBuyLamports: input.initialBuyLamports,
    estimate: emptyEstimate(input.initialBuyLamports),
  };
}

export async function simulateAndEstimate(
  connection: Connection,
  prepared: PreparedLaunchTx,
  user: PublicKey,
): Promise<PreparedLaunchTx> {
  let simulation;
  try {
    simulation = await connection.simulateTransaction(prepared.transaction, {
      sigVerify: false,
      replaceRecentBlockhash: true,
      commitment: "processed",
    });
  } catch (error) {
    throw new LaunchError("RPC_UNAVAILABLE", "Transaction simulation could not run.");
  }
  if (simulation.value.err) {
    const detail = JSON.stringify(simulation.value.err);
    if (isInsufficientBalance(detail) || isInsufficientBalance(simulation.value.logs?.join(" ") || "")) {
      throw new LaunchError("INSUFFICIENT_BALANCE", "This wallet does not have enough SOL for the review total.");
    }
    throw new LaunchError("SIMULATION_FAILED", "Simulation failed. Sign is disabled until the transaction is rebuilt.");
  }
  const feeMessage = await connection.getFeeForMessage(prepared.transaction.message, "confirmed");
  const networkFeeLamports = BigInt(feeMessage.value ?? 5000);
  const rentCurve = BigInt(await connection.getMinimumBalanceForRentExemption(BONDING_CURVE_NEW_SIZE));
  const rentAta = BigInt(await connection.getMinimumBalanceForRentExemption(165));
  const rentMint = BigInt(await connection.getMinimumBalanceForRentExemption(879));
  const rentLamports = rentCurve + rentAta + rentMint;
  const subtotal = networkFeeLamports + rentLamports + prepared.initialBuyLamports;
  const bufferLamports = applyPercentBuffer(subtotal, COST_BUFFER_PERCENT);
  const estimate: CostEstimate = {
    pumpCreationLamports: 0n,
    mixbornFeeLamports: 0n,
    networkFeeLamports,
    rentLamports,
    initialBuyLamports: prepared.initialBuyLamports,
    bufferLamports,
    maxDebitLamports: subtotal + bufferLamports,
    bufferLabel: "includes 10% safety buffer",
  };
  const balance = await connection.getBalance(user, "confirmed");
  if (BigInt(balance) < estimate.maxDebitLamports) {
    throw new LaunchError("INSUFFICIENT_BALANCE", "This wallet does not have enough SOL for the review total.");
  }
  return { ...prepared, estimate };
}

export function formatCost(estimate: CostEstimate | null, fallback: string): {
  pumpCreation: string;
  mixbornFee: string;
  networkRent: string;
  initialBuy: string;
  maxDebit: string;
  bufferNote: string | null;
} {
  if (!estimate) {
    return {
      pumpCreation: "0 SOL",
      mixbornFee: "0 SOL",
      networkRent: fallback,
      initialBuy: fallback,
      maxDebit: fallback,
      bufferNote: null,
    };
  }
  return {
    pumpCreation: lamportsToSolLabel(estimate.pumpCreationLamports),
    mixbornFee: lamportsToSolLabel(estimate.mixbornFeeLamports),
    networkRent: lamportsToSolLabel(estimate.networkFeeLamports + estimate.rentLamports),
    initialBuy: lamportsToSolLabel(estimate.initialBuyLamports),
    maxDebit: lamportsToSolLabel(estimate.maxDebitLamports),
    bufferNote: estimate.bufferLabel,
  };
}

export async function signLaunchTransaction(
  wallet: LaunchWallet,
  prepared: PreparedLaunchTx,
): Promise<VersionedTransaction> {
  if (!wallet.publicKey.equals(prepared.user)) {
    throw new LaunchError("INVALID_INPUT", "Connected wallet does not match the transaction payer.");
  }
  try {
    return await wallet.signTransaction(prepared.transaction);
  } catch (error) {
    if (isWalletRejection(error)) {
      throw new LaunchError("WALLET_REJECTED", "Wallet signature was rejected. Nothing was sent.");
    }
    throw mapSendFailure(error);
  }
}

export async function submitLaunchTransaction(
  connection: Connection,
  signed: VersionedTransaction,
): Promise<string> {
  try {
    return await connection.sendRawTransaction(signed.serialize(), {
      skipPreflight: false,
      maxRetries: 0,
    });
  } catch (error) {
    if (isStaleBlockhash(error)) {
      throw new LaunchError("TRANSACTION_EXPIRED", "The blockhash expired. Rebuild the same mint transaction.");
    }
    throw new LaunchError("TRANSACTION_UNKNOWN", "Send result is unknown. Reconcile before building a new mint.");
  }
}

export async function confirmLaunch(input: {
  connection: Connection;
  signature: string;
  blockhash: string;
  lastValidBlockHeight: number;
  mint: PublicKey;
  user: PublicKey;
  uri: string;
}): Promise<ConfirmResult> {
  try {
    const confirmation = await input.connection.confirmTransaction(
      {
        signature: input.signature,
        blockhash: input.blockhash,
        lastValidBlockHeight: input.lastValidBlockHeight,
      },
      "confirmed",
    );
    if (confirmation.value.err) {
      throw new LaunchError("LAUNCH_NOT_CONFIRMED", "The transaction landed with an error. Token is not launched.");
    }
  } catch (error) {
    if (error instanceof LaunchError) throw error;
    if (isStaleBlockhash(error)) {
      throw new LaunchError("TRANSACTION_EXPIRED", "The blockhash expired. Rebuild the same mint transaction.");
    }
    throw new LaunchError("TRANSACTION_UNKNOWN", "Confirmation timed out. Reconcile before building a new mint.");
  }
  const verified = await verifyOnchainLaunch(input.connection, input.mint, input.user, input.uri);
  if (!verified.ok) {
    throw new LaunchError("LAUNCH_NOT_CONFIRMED", verified.reason);
  }
  return { signature: input.signature, mint: input.mint.toBase58() };
}

export async function verifyOnchainLaunch(
  connection: Connection,
  mint: PublicKey,
  user: PublicKey,
  uri: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const mintInfo = await connection.getAccountInfo(mint, "confirmed");
  if (!mintInfo) {
    return { ok: false, reason: "Mint account does not exist yet. Token is not launched." };
  }
  const curveInfo = await connection.getAccountInfo(bondingCurvePda(mint), "confirmed");
  if (!curveInfo) {
    return { ok: false, reason: "Bonding curve account does not exist yet. Token is not launched." };
  }
  let curve;
  try {
    curve = PUMP_SDK.decodeBondingCurve(curveInfo);
  } catch {
    return { ok: false, reason: "Bonding curve could not be decoded. Token is not launched." };
  }
  if (!curve.creator.equals(user)) {
    return { ok: false, reason: "On-chain creator does not match the connected wallet." };
  }
  try {
    const metadata = await getTokenMetadata(connection, mint);
    if (!metadata || metadata.uri.trim() !== uri) {
      return { ok: false, reason: "On-chain metadata URI does not match the pinned URI." };
    }
  } catch {
    return { ok: false, reason: "On-chain metadata URI could not be verified. Token is not launched." };
  }
  return { ok: true };
}

export type ReconcileInput = {
  signature: string | null;
  signatureStatus: "confirmed" | "finalized" | "failed" | "pending" | "unknown" | null;
  mintExists: boolean;
  bondingCurveOk: boolean;
  creatorMatches: boolean;
  uriMatches: boolean;
  blockhashExpired: boolean;
};

export type ReconcileDecision = "confirmed" | "wait" | "rebuild" | "unknown";

export function reconcileLaunch(input: ReconcileInput): ReconcileDecision {
  if (input.signatureStatus === "failed") return "rebuild";
  if (
    (input.signatureStatus === "confirmed" || input.signatureStatus === "finalized") &&
    input.mintExists &&
    input.bondingCurveOk &&
    input.creatorMatches &&
    input.uriMatches
  ) {
    return "confirmed";
  }
  if (input.signature && (input.signatureStatus === "pending" || input.signatureStatus === "unknown")) {
    return "wait";
  }
  if (!input.mintExists && input.blockhashExpired) return "rebuild";
  if (!input.signature && !input.mintExists) return "rebuild";
  return "unknown";
}

let launchSubmitLock = false;

export function acquireLaunchSubmit(): boolean {
  if (launchSubmitLock) return false;
  launchSubmitLock = true;
  return true;
}

export function releaseLaunchSubmit(): void {
  launchSubmitLock = false;
}

function emptyEstimate(initialBuyLamports: bigint): CostEstimate {
  return {
    pumpCreationLamports: 0n,
    mixbornFeeLamports: 0n,
    networkFeeLamports: 0n,
    rentLamports: 0n,
    initialBuyLamports,
    bufferLamports: 0n,
    maxDebitLamports: 0n,
    bufferLabel: "includes 10% safety buffer",
  };
}

export { isWalletRejection, isInsufficientBalance, isStaleBlockhash, mapSendFailure, LaunchError };
