import { PUMP_SDK, bondingCurvePda } from "@pump-fun/pump-sdk";
import { getTokenMetadata, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Connection, PublicKey } from "@solana/web3.js";

export type OnchainStatus = "on_curve" | "graduated" | "unknown";

export type OnchainTokenView = {
  exists: boolean;
  status: OnchainStatus;
  creator: string | null;
  progress: number | null;
  name: string | null;
  symbol: string | null;
  uri: string | null;
  lineage: { parent_a?: string; parent_b?: string } | null;
};

export async function readOnchainToken(connection: Connection, mintText: string): Promise<OnchainTokenView> {
  let mint: PublicKey;
  try {
    mint = new PublicKey(mintText);
  } catch {
    return emptyOnchain();
  }
  const mintInfo = await connection.getAccountInfo(mint, "confirmed");
  if (!mintInfo) return emptyOnchain();
  const owner = mintInfo.owner.toBase58();
  if (owner !== TOKEN_PROGRAM_ID.toBase58() && owner !== TOKEN_2022_PROGRAM_ID.toBase58()) {
    return emptyOnchain();
  }

  let status: OnchainStatus = "unknown";
  let creator: string | null = null;
  let progress: number | null = null;
  try {
    const curveInfo = await connection.getAccountInfo(bondingCurvePda(mint), "confirmed");
    if (curveInfo) {
      const curve = PUMP_SDK.decodeBondingCurve(curveInfo);
      creator = curve.creator.toBase58();
      status = curve.complete ? "graduated" : "on_curve";
      progress = safeCurveProgress(curve.complete, curve.realTokenReserves, curve.tokenTotalSupply);
    }
  } catch {
    status = "unknown";
  }

  let name: string | null = null;
  let symbol: string | null = null;
  let uri: string | null = null;
  try {
    const metadata = await getTokenMetadata(connection, mint);
    name = metadata?.name?.trim() || null;
    symbol = metadata?.symbol?.trim() || null;
    uri = metadata?.uri?.trim() || null;
  } catch {
    /* metadata pointer may be absent */
  }

  const lineage = uri ? await readLineage(uri) : null;
  return { exists: true, status, creator, progress, name, symbol, uri, lineage };
}

function safeCurveProgress(complete: boolean, realTokenReserves: { toString(): string }, tokenTotalSupply: { toString(): string }): number | null {
  if (complete) return 1;
  try {
    const real = Number(realTokenReserves.toString());
    const total = Number(tokenTotalSupply.toString());
    if (!Number.isFinite(real) || !Number.isFinite(total) || total <= 0 || real < 0 || real > total) return null;
    const value = 1 - real / total;
    if (value < 0 || value > 1) return null;
    return value;
  } catch {
    return null;
  }
}

async function readLineage(uri: string): Promise<{ parent_a?: string; parent_b?: string } | null> {
  if (!uri.startsWith("https://")) return null;
  try {
    const response = await fetch(uri, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) return null;
    const json = (await response.json()) as { mixborn?: { parent_a_mint?: string; parent_b_mint?: string } };
    const parentA = json.mixborn?.parent_a_mint;
    const parentB = json.mixborn?.parent_b_mint;
    if (!parentA && !parentB) return null;
    return { parent_a: parentA, parent_b: parentB };
  } catch {
    return null;
  }
}

function emptyOnchain(): OnchainTokenView {
  return {
    exists: false,
    status: "unknown",
    creator: null,
    progress: null,
    name: null,
    symbol: null,
    uri: null,
    lineage: null,
  };
}
