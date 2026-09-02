export type PendingLaunchState = "prepared" | "submitted" | "confirmed" | "failed" | "unknown";

export type PendingLaunch = {
  token: string | null;
  creator: string | null;
  metadata_uri: string;
  image_uri?: string;
  image_cid?: string;
  metadata_cid?: string;
  image_hash: string;
  tx_hash: string | null;
  created_at: string;
  state: PendingLaunchState;
  name?: string;
  ticker?: string;
  parent_a?: string;
  parent_b?: string;
  generated?: boolean;
};

const PENDING_KEY = "mixborn.pendingLaunch";
const SECRET_KEYS = ["secret", "private", "seed", "mnemonic", "jwt", "pinata", "keypair"];

export function readPendingLaunch(): PendingLaunch | null {
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    return stripPendingSecrets(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function writePendingLaunch(record: PendingLaunch): void {
  localStorage.setItem(PENDING_KEY, JSON.stringify(stripPendingSecrets(record)));
}

export function clearPendingLaunch(): void {
  localStorage.removeItem(PENDING_KEY);
}

/** A transaction hash is 32 bytes of hex; anything else is not linkable. */
export function isPublicTxHash(value: unknown): value is string {
  return typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value);
}

export function stripPendingSecrets(raw: unknown): PendingLaunch | null {
  if (!raw || typeof raw !== "object") return null;
  const input = raw as Record<string, unknown>;
  for (const key of Object.keys(input)) {
    if (SECRET_KEYS.some((secret) => key.toLowerCase().includes(secret))) return null;
  }
  const metadataUri = String(input.metadata_uri || "");
  const imageHash = String(input.image_hash || "");
  if (!metadataUri || !imageHash) return null;
  const state = String(input.state || "prepared");
  const allowed: PendingLaunchState[] = ["prepared", "submitted", "confirmed", "failed", "unknown"];
  return {
    token: typeof input.token === "string" && input.token ? input.token : null,
    creator: typeof input.creator === "string" && input.creator ? input.creator : null,
    metadata_uri: metadataUri,
    image_uri: typeof input.image_uri === "string" ? input.image_uri : undefined,
    image_cid: typeof input.image_cid === "string" ? input.image_cid : undefined,
    metadata_cid: typeof input.metadata_cid === "string" ? input.metadata_cid : undefined,
    image_hash: imageHash,
    tx_hash: isPublicTxHash(input.tx_hash) ? input.tx_hash : null,
    created_at: typeof input.created_at === "string" ? input.created_at : new Date().toISOString(),
    state: allowed.includes(state as PendingLaunchState) ? (state as PendingLaunchState) : "prepared",
    name: typeof input.name === "string" ? input.name : undefined,
    ticker: typeof input.ticker === "string" ? input.ticker : undefined,
    parent_a: typeof input.parent_a === "string" ? input.parent_a : undefined,
    parent_b: typeof input.parent_b === "string" ? input.parent_b : undefined,
    generated: input.generated === true,
  };
}
