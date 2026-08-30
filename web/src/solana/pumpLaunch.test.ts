import BN from "bn.js";
import { PUMP_PROGRAM_ID, type Global } from "@pump-fun/pump-sdk";
import { NATIVE_MINT } from "@solana/spl-token";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { afterEach, describe, expect, it } from "vitest";
import { walletPhase } from "./walletPhase";
import {
  acquireLaunchSubmit,
  buildLaunchInstructions,
  compileLaunchTransaction,
  instructionProgramIds,
  mintSignaturePresent,
  reconcileLaunch,
  releaseLaunchSubmit,
  signLaunchTransaction,
  simulateAndEstimate,
  submitLaunchTransaction,
  validateLaunchFields,
} from "./pumpLaunch";
import { mintKeypairForUri, wipeMintSecret } from "./mintMemory";
import { unexpectedPrograms } from "./programAllowlist";
import { solToLamports } from "./lamports";

const URI =
  "https://gateway.pinata.cloud/ipfs/bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi";

function fixtureGlobal(overrides: Partial<Global> = {}): Global {
  const pk = PublicKey.default;
  return {
    initialized: true,
    authority: pk,
    feeRecipient: pk,
    initialVirtualTokenReserves: new BN("1073000000000000"),
    initialVirtualSolReserves: new BN("30000000000"),
    initialRealTokenReserves: new BN("793100000000000"),
    tokenTotalSupply: new BN("1000000000000000"),
    feeBasisPoints: new BN(100),
    withdrawAuthority: pk,
    enableMigrate: true,
    poolMigrationFee: new BN(0),
    creatorFeeBasisPoints: new BN(0),
    feeRecipients: [pk],
    setCreatorAuthority: pk,
    adminSetCreatorAuthority: pk,
    createV2Enabled: true,
    whitelistPda: pk,
    reservedFeeRecipient: pk,
    mayhemModeEnabled: true,
    reservedFeeRecipients: [],
    isCashbackEnabled: false,
    buybackFeeRecipients: [],
    buybackBasisPoints: new BN(0),
    initialVirtualQuoteReserves: new BN("30000000000"),
    whitelistedQuoteMints: [NATIVE_MINT],
    ...overrides,
  };
}

function fakeConnection(overrides: Record<string, unknown> = {}): Connection {
  return {
    getLatestBlockhash: async () => ({
      blockhash: Keypair.generate().publicKey.toBase58(),
      lastValidBlockHeight: 123,
    }),
    simulateTransaction: async () => ({ value: { err: null, logs: ["ok"] } }),
    getFeeForMessage: async () => ({ value: 5000 }),
    getMinimumBalanceForRentExemption: async (size: number) => 890880 + size,
    getBalance: async () => 5_000_000_000,
    sendRawTransaction: async () => "sent",
    ...overrides,
  } as unknown as Connection;
}

afterEach(() => {
  wipeMintSecret();
  releaseLaunchSubmit();
});

describe("create_v2 instruction construction", () => {
  it("builds create_v2 with Mayhem false, Cashback false, SOL quote, and no extra programs", async () => {
    const mint = Keypair.generate();
    const user = Keypair.generate().publicKey;
    const ixs = await buildLaunchInstructions({
      mint: mint.publicKey,
      name: "Mixborn",
      symbol: "MIX",
      uri: URI,
      user,
      initialBuyLamports: 0n,
    });
    const programs = instructionProgramIds(ixs);
    expect(programs.some((id) => id === PUMP_PROGRAM_ID.toBase58())).toBe(true);
    expect(unexpectedPrograms(programs)).toEqual([]);
    const createIx = ixs[1];
    expect(createIx.keys[0].pubkey.equals(mint.publicKey)).toBe(true);
    expect(createIx.keys[0].isSigner).toBe(true);
  });

  it("builds official create_v2 + buy_v2 for a small initial buy", async () => {
    const mint = Keypair.generate();
    const user = Keypair.generate().publicKey;
    const ixs = await buildLaunchInstructions({
      mint: mint.publicKey,
      name: "Mixborn",
      symbol: "MIX",
      uri: URI,
      user,
      initialBuyLamports: solToLamports("0.05"),
      global: fixtureGlobal(),
    });
    expect(ixs.length).toBeGreaterThan(2);
    expect(unexpectedPrograms(instructionProgramIds(ixs))).toEqual([]);
    expect(instructionProgramIds(ixs).filter((id) => id === PUMP_PROGRAM_ID.toBase58()).length).toBeGreaterThanOrEqual(2);
  });

  it("stops when create_v2 is disabled on the cluster", async () => {
    await expect(
      buildLaunchInstructions({
        mint: Keypair.generate().publicKey,
        name: "Mixborn",
        symbol: "MIX",
        uri: URI,
        user: Keypair.generate().publicKey,
        initialBuyLamports: solToLamports("0.05"),
        global: fixtureGlobal({ createV2Enabled: false }),
      }),
    ).rejects.toMatchObject({ code: "CREATE_V2_DISABLED" });
  });
});

describe("client mint signature and simulation gates", () => {
  it("partial-signs the mint and leaves the wallet as payer", async () => {
    const mint = Keypair.generate();
    const payer = Keypair.generate();
    const ixs = await buildLaunchInstructions({
      mint: mint.publicKey,
      name: "Mixborn",
      symbol: "MIX",
      uri: URI,
      user: payer.publicKey,
      initialBuyLamports: 0n,
    });
    const prepared = await compileLaunchTransaction({
      connection: fakeConnection(),
      instructions: ixs,
      payer: payer.publicKey,
      mint,
      uri: URI,
      initialBuyLamports: 0n,
    });
    expect(mintSignaturePresent(prepared.transaction, mint.publicKey)).toBe(true);
    expect(prepared.transaction.message.staticAccountKeys[0].equals(payer.publicKey)).toBe(true);
  });

  it("maps simulation failure, wallet reject, insufficient SOL, stale blockhash, and unknown send", async () => {
    const mint = Keypair.generate();
    const payer = Keypair.generate();
    const ixs = await buildLaunchInstructions({
      mint: mint.publicKey,
      name: "Mixborn",
      symbol: "MIX",
      uri: URI,
      user: payer.publicKey,
      initialBuyLamports: 0n,
    });
    const prepared = await compileLaunchTransaction({
      connection: fakeConnection(),
      instructions: ixs,
      payer: payer.publicKey,
      mint,
      uri: URI,
      initialBuyLamports: 0n,
    });
    await expect(
      simulateAndEstimate(
        fakeConnection({
          simulateTransaction: async () => ({ value: { err: { InstructionError: [0, "Custom"] }, logs: ["fail"] } }),
        }),
        prepared,
        payer.publicKey,
      ),
    ).rejects.toMatchObject({ code: "SIMULATION_FAILED" });

    await expect(
      simulateAndEstimate(
        fakeConnection({
          simulateTransaction: async () => ({ value: { err: "InsufficientFunds", logs: ["insufficient lamports"] } }),
        }),
        prepared,
        payer.publicKey,
      ),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_BALANCE" });

    await expect(
      signLaunchTransaction(
        {
          publicKey: payer.publicKey,
          signTransaction: async () => {
            throw new Error("User rejected the request.");
          },
        },
        prepared,
      ),
    ).rejects.toMatchObject({ code: "WALLET_REJECTED" });

    await expect(
      submitLaunchTransaction(
        fakeConnection({
          sendRawTransaction: async () => {
            throw new Error("Blockhash not found");
          },
        }),
        prepared.transaction,
      ),
    ).rejects.toMatchObject({ code: "TRANSACTION_EXPIRED" });

    await expect(
      submitLaunchTransaction(
        fakeConnection({
          sendRawTransaction: async () => {
            throw new Error("fetch failed");
          },
        }),
        prepared.transaction,
      ),
    ).rejects.toMatchObject({ code: "TRANSACTION_UNKNOWN" });
  });
});

describe("idempotency and reconciliation", () => {
  it("ignores a duplicate submit lock and keeps the same mint for a URI", () => {
    expect(acquireLaunchSubmit()).toBe(true);
    expect(acquireLaunchSubmit()).toBe(false);
    releaseLaunchSubmit();
    const first = mintKeypairForUri(URI);
    const second = mintKeypairForUri(URI);
    expect(first.publicKey.equals(second.publicKey)).toBe(true);
  });

  it("reconciles unknown send without inventing success", () => {
    expect(
      reconcileLaunch({
        signature: "5".repeat(88),
        signatureStatus: "unknown",
        mintExists: false,
        bondingCurveOk: false,
        creatorMatches: false,
        uriMatches: false,
        blockhashExpired: false,
      }),
    ).toBe("wait");
    expect(
      reconcileLaunch({
        signature: "5".repeat(88),
        signatureStatus: "confirmed",
        mintExists: true,
        bondingCurveOk: true,
        creatorMatches: true,
        uriMatches: true,
        blockhashExpired: false,
      }),
    ).toBe("confirmed");
    expect(
      reconcileLaunch({
        signature: null,
        signatureStatus: null,
        mintExists: false,
        bondingCurveOk: false,
        creatorMatches: false,
        uriMatches: false,
        blockhashExpired: true,
      }),
    ).toBe("rebuild");
  });

  it("rejects metadata URI over 200 characters", () => {
    expect(() => validateLaunchFields("Name", "MIX", `https://example.com/${"a".repeat(200)}`)).toThrow(
      /200-character/,
    );
  });
});

describe("wallet states and cost units", () => {
  it("exposes disconnected, connecting, connected, and rejected", () => {
    expect(walletPhase({ connected: false, connecting: false, rejected: false })).toBe("disconnected");
    expect(walletPhase({ connected: false, connecting: true, rejected: false })).toBe("connecting");
    expect(walletPhase({ connected: true, connecting: false, rejected: false })).toBe("connected");
    expect(walletPhase({ connected: false, connecting: false, rejected: true })).toBe("rejected");
  });

  it("converts 0 and 0.05 SOL without floating error", () => {
    expect(solToLamports("0")).toBe(0n);
    expect(solToLamports("0.05")).toBe(50_000_000n);
  });
});
