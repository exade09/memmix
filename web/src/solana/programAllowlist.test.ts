import { PUMP_FEE_PROGRAM_ID, PUMP_PROGRAM_ID } from "@pump-fun/pump-sdk";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { SystemProgram } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import { allowedLaunchProgramIds, sdkIdsMatchDocs, unexpectedPrograms } from "./programAllowlist";
import { DOCUMENTED_PROGRAM_IDS } from "./pinned";
import { isAllowedRpcMethod, RPC_ALLOWED_METHODS } from "./rpcAllowlist";

describe("program and RPC allowlists", () => {
  it("snapshots pinned SDK program IDs against official docs from 2026-08-25", () => {
    expect(sdkIdsMatchDocs()).toBe(true);
    expect(PUMP_PROGRAM_ID.toBase58()).toBe(DOCUMENTED_PROGRAM_IDS.pump);
    expect(TOKEN_2022_PROGRAM_ID.toBase58()).toBe(DOCUMENTED_PROGRAM_IDS.token2022);
    expect(allowedLaunchProgramIds().has(SystemProgram.programId.toBase58())).toBe(true);
    expect(allowedLaunchProgramIds().has(PUMP_FEE_PROGRAM_ID.toBase58())).toBe(true);
  });

  it("rejects an unknown program before wallet", () => {
    expect(unexpectedPrograms(["Fake111111111111111111111111111111111111111"])).toEqual([
      "Fake111111111111111111111111111111111111111",
    ]);
    expect(unexpectedPrograms([PUMP_PROGRAM_ID.toBase58()])).toEqual([]);
  });

  it("allows only the documented RPC methods", () => {
    expect(RPC_ALLOWED_METHODS).toContain("sendTransaction");
    expect(isAllowedRpcMethod("getLatestBlockhash")).toBe(true);
    expect(isAllowedRpcMethod("getProgramAccounts")).toBe(false);
    expect(isAllowedRpcMethod("getLogs")).toBe(false);
  });
});
