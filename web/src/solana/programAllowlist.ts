import {
  MAYHEM_PROGRAM_ID,
  PUMP_FEE_PROGRAM_ID,
  PUMP_PROGRAM_ID,
} from "@pump-fun/pump-sdk";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { ComputeBudgetProgram, SystemProgram } from "@solana/web3.js";
import { DOCUMENTED_PROGRAM_IDS } from "./pinned";

export const UNEXPECTED_PROGRAM = "UNEXPECTED_PROGRAM";

export function allowedLaunchProgramIds(): Set<string> {
  return new Set([
    PUMP_PROGRAM_ID.toBase58(),
    TOKEN_2022_PROGRAM_ID.toBase58(),
    TOKEN_PROGRAM_ID.toBase58(),
    ASSOCIATED_TOKEN_PROGRAM_ID.toBase58(),
    SystemProgram.programId.toBase58(),
    ComputeBudgetProgram.programId.toBase58(),
    MAYHEM_PROGRAM_ID.toBase58(),
    PUMP_FEE_PROGRAM_ID.toBase58(),
  ]);
}

export function sdkIdsMatchDocs(): boolean {
  return (
    PUMP_PROGRAM_ID.toBase58() === DOCUMENTED_PROGRAM_IDS.pump &&
    TOKEN_2022_PROGRAM_ID.toBase58() === DOCUMENTED_PROGRAM_IDS.token2022 &&
    ASSOCIATED_TOKEN_PROGRAM_ID.toBase58() === DOCUMENTED_PROGRAM_IDS.ata &&
    SystemProgram.programId.toBase58() === DOCUMENTED_PROGRAM_IDS.system &&
    MAYHEM_PROGRAM_ID.toBase58() === DOCUMENTED_PROGRAM_IDS.mayhem &&
    PUMP_FEE_PROGRAM_ID.toBase58() === DOCUMENTED_PROGRAM_IDS.pumpFees
  );
}

export function unexpectedPrograms(programIds: string[]): string[] {
  const allowed = allowedLaunchProgramIds();
  return [...new Set(programIds)].filter((id) => !allowed.has(id));
}

export function assertLaunchPrograms(programIds: string[]): void {
  const unexpected = unexpectedPrograms(programIds);
  if (unexpected.length) {
    throw new Error(`${UNEXPECTED_PROGRAM}:${unexpected.join(",")}`);
  }
}
