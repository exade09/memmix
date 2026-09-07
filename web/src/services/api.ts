export type ApiError = {
  code: string;
  message: string;
};

export type ApiEnvelope<T> = {
  success: boolean;
  data: T | null;
  error: ApiError | null;
  request_id: string;
};

async function readEnvelope<T>(response: Response): Promise<ApiEnvelope<T>> {
  const payload = (await response.json()) as ApiEnvelope<T>;
  return payload;
}

export type TokenSummary = {
  mint: string;
  name: string;
  symbol: string;
  image_url?: string;
  pair_address?: string;
  dex_id?: string;
  liquidity_usd?: number | null;
  market_cap?: number | null;
  volume_24h_usd?: number | null;
  price_change_1h?: number | null;
  created_at?: number | null;
  source: "dexscreener" | "bundled";
  age_minutes?: number | null;
  risk_flags?: string[];
  score?: number | null;
  signal?: string | null;
};

export type FeedResponse = {
  tokens: TokenSummary[];
  generated_at?: string;
  data_source?: string;
  fallback_error?: string;
};

export type SearchResponse = {
  items: TokenSummary[];
  collision_warning?: string | null;
};

export class TokenApiError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export type TokenDetail = {
  mint: string;
  onchain: {
    status: string;
    creator: string | null;
    mint_exists?: boolean | null;
    progress?: number | null;
  };
  metadata: {
    name: string | null;
    symbol: string | null;
    image_url: string | null;
    socials: { type: string; url: string }[];
  };
  market: {
    pair_address?: string | null;
    dex_id?: string | null;
    liquidity_usd?: number | null;
    volume_24h_usd?: number | null;
    price_change_1h?: number | null;
    age_minutes?: number | null;
    pair_url?: string | null;
  } | null;
  lineage: { parent_a?: string; parent_b?: string } | null;
  notice: string | null;
};

export type FeedQuery = {
  tab?: string;
  limit?: number;
  min_liquidity?: number;
  min_volume?: number;
  max_age_hours?: number;
  has_image?: boolean;
};

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    await new Promise((resolve) => setTimeout(resolve, 400 + Math.random() * 400));
    return fn();
  }
}

export async function fetchFeedResult(query: FeedQuery = {}): Promise<FeedResponse> {
  const params = new URLSearchParams();
  params.set("tab", query.tab || "trending");
  params.set("limit", String(query.limit ?? 24));
  if (query.min_liquidity != null) params.set("min_liquidity", String(query.min_liquidity));
  if (query.min_volume != null) params.set("min_volume", String(query.min_volume));
  if (query.max_age_hours != null) params.set("max_age_hours", String(query.max_age_hours));
  if (query.has_image != null) params.set("has_image", query.has_image ? "true" : "false");
  return withRetry(async () => {
    const response = await fetch(`/api/feed?${params.toString()}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    const payload = await readEnvelope<FeedResponse>(response);
    if (!payload.success || !payload.data) {
      throw new Error(payload.error?.message || "The scanner is offline.");
    }
    return payload.data;
  });
}

export async function fetchFeed(tab = "trending", limit = 6): Promise<TokenSummary[]> {
  const result = await fetchFeedResult({ tab, limit });
  return result.tokens;
}

export async function searchTokensResult(
  query: string,
  limit = 8,
  signal?: AbortSignal,
): Promise<SearchResponse> {
  const response = await fetch(
    `/api/search?q=${encodeURIComponent(query)}&limit=${limit}`,
    { cache: "no-store", signal: signal ?? AbortSignal.timeout(10_000) },
  );
  const payload = await readEnvelope<SearchResponse>(response);
  if (!payload.success || !payload.data) {
    throw new Error(payload.error?.message || "The scanner is offline.");
  }
  return {
    items: payload.data.items ?? [],
    collision_warning: payload.data.collision_warning ?? null,
  };
}

export async function searchTokens(
  query: string,
  limit = 8,
  signal?: AbortSignal,
): Promise<TokenSummary[]> {
  const result = await searchTokensResult(query, limit, signal);
  return result.items;
}

export async function fetchToken(mint: string, signal?: AbortSignal): Promise<TokenDetail> {
  const response = await fetch(`/api/token/${encodeURIComponent(mint)}`, {
    cache: "no-store",
    signal: signal ?? AbortSignal.timeout(10_000),
  });
  const payload = await readEnvelope<TokenDetail>(response);
  if (!payload.success || !payload.data) {
    throw new TokenApiError(
      payload.error?.code || "SOURCE_UNAVAILABLE",
      payload.error?.message || "Token data is unavailable.",
    );
  }
  return payload.data;
}

export type MixConcept = {
  id: string;
  name: string;
  ticker: string;
  description: string;
  avatar_ready?: boolean;
  hook?: string;
  recommended?: boolean;
  internal?: {
    character_hook?: string;
    strategy?: string;
    parent_a_trait?: string;
    parent_b_trait?: string;
    visual_prompt?: string;
  };
};

export type MixConceptsResponse = {
  parents: { a_mint: string; b_mint: string };
  concepts: MixConcept[];
  source: "openai" | "fallback";
  fallback: boolean;
  fallback_notice: string | null;
  repaired?: boolean;
};

export class MixApiError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export async function mixConcepts(
  parentA: ParentLike,
  parentB: ParentLike,
  userHint = "",
  signal?: AbortSignal,
): Promise<MixConceptsResponse> {
  const response = await fetch("/api/mix/concepts", {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ parent_a: parentA, parent_b: parentB, user_hint: userHint.slice(0, 160) }),
    signal: signal ?? AbortSignal.timeout(55_000),
  });
  const payload = await readEnvelope<MixConceptsResponse>(response);
  if (!payload.success || !payload.data) {
    throw new MixApiError(
      payload.error?.code || "AI_UNAVAILABLE",
      payload.error?.message || "The logic mixer took too long. Nothing was charged for an avatar.",
    );
  }
  return payload.data;
}

export type AvatarJobStart = {
  job_token: string;
  status: "queued";
  poll_after_ms: number;
  base_parent?: "a" | "b";
};

export type AvatarJobStatus = {
  status: "queued" | "processing" | "completed" | "failed" | "expired";
  image_url?: string;
  width?: number;
  height?: number;
  content_type?: string;
  output_hash?: string;
  code?: string;
  message?: string;
};

export async function startAvatarJob(form: FormData, signal?: AbortSignal): Promise<AvatarJobStart> {
  const response = await fetch("/api/mix/avatar/start", {
    method: "POST",
    cache: "no-store",
    body: form,
    signal: signal ?? AbortSignal.timeout(45_000),
  });
  const payload = await readEnvelope<AvatarJobStart>(response);
  if (!payload.success || !payload.data) {
    throw new MixApiError(
      payload.error?.code || "IMAGE_UNAVAILABLE",
      payload.error?.message || "This combination could not be rendered. Edit the concept or upload an image.",
    );
  }
  return payload.data;
}

export async function avatarJobStatus(jobToken: string, signal?: AbortSignal): Promise<AvatarJobStatus> {
  const response = await fetch(`/api/mix/avatar/status?job=${encodeURIComponent(jobToken)}`, {
    cache: "no-store",
    signal,
  });
  const payload = await readEnvelope<AvatarJobStatus>(response);
  if (!payload.success || !payload.data) {
    throw new MixApiError(
      payload.error?.code || "IMAGE_UNAVAILABLE",
      payload.error?.message || "The drawing is still processing. You can keep this tab open or retry later.",
    );
  }
  return payload.data;
}

type ParentLike = {
  mint: string;
  name: string;
  symbol: string;
  image_url?: string;
  description?: string;
};

export class LaunchApiError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export type MetadataPinResult = {
  image_uri: string;
  image_cid: string;
  metadata_uri: string;
  metadata_cid: string;
  image_sha256: string;
  name: string;
  ticker: string;
};

export async function pinMetadata(form: FormData, signal?: AbortSignal): Promise<MetadataPinResult> {
  const response = await fetch("/api/metadata/pin", {
    method: "POST",
    cache: "no-store",
    body: form,
    signal: signal ?? AbortSignal.timeout(45_000),
  });
  const payload = await readEnvelope<MetadataPinResult>(response);
  if (!payload.success || !payload.data) {
    throw new LaunchApiError(
      payload.error?.code || "METADATA_PIN_FAILED",
      payload.error?.message || "Metadata pinning failed. Retry pinning.",
    );
  }
  if (JSON.stringify(payload.data).includes("Bearer ")) {
    throw new LaunchApiError("METADATA_PIN_FAILED", "Metadata pinning failed.");
  }
  return payload.data;
}

export type NameCheckResult = {
  check_available: boolean;
  name_matches: number;
  ticker_matches: number;
  notice: string;
};

export async function checkLaunchName(name: string, ticker: string, signal?: AbortSignal): Promise<NameCheckResult> {
  const params = new URLSearchParams({ name, ticker });
  const response = await fetch(`/api/launch/name-check?${params.toString()}`, {
    cache: "no-store",
    signal: signal ?? AbortSignal.timeout(10_000),
  });
  const payload = await readEnvelope<NameCheckResult>(response);
  if (!payload.success || !payload.data) {
    return {
      check_available: false,
      name_matches: 0,
      ticker_matches: 0,
      notice: "Check unavailable",
    };
  }
  return payload.data;
}

export type LaunchHealth = {
  chain_id?: number;
  status: string;
  scanner: string;
  text_ai: string;
  image_ai: string;
  metadata: string;
  rpc: string;
  images?: string;
  image_jobs?: string;
  launchpad?: string;
  launchpad_address?: string;
  native_launch?: boolean;
  mainnet_launch?: boolean;
};

export async function fetchLaunchHealth(signal?: AbortSignal): Promise<LaunchHealth | null> {
  try {
    const response = await fetch("/api/health", {
      cache: "no-store",
      signal: signal ?? AbortSignal.timeout(8_000),
    });
    const payload = await readEnvelope<LaunchHealth>(response);
    if (!payload.success || !payload.data) return null;
    const dumped = JSON.stringify(payload.data);
    if (dumped.includes("Bearer ") || dumped.includes("sk-")) return null;
    return payload.data;
  } catch {
    return null;
  }
}

export type ContractAddressState = {
  ca: string;
  updated_at: string | null;
};

/** Public read. No auth: the value is displayed in the header for everyone. */
export async function fetchContractAddress(signal?: AbortSignal): Promise<ContractAddressState> {
  try {
    const response = await fetch("/api/ca", {
      cache: "no-store",
      signal: signal ?? AbortSignal.timeout(8_000),
    });
    const payload = await readEnvelope<ContractAddressState>(response);
    if (!payload.success || !payload.data) return { ca: "", updated_at: null };
    return payload.data;
  } catch {
    return { ca: "", updated_at: null };
  }
}

export async function updateContractAddress(
  password: string,
  ca: string,
): Promise<{ ok: true; data: ContractAddressState & { live_in_seconds: number } } | { ok: false; error: ApiError }> {
  try {
    const response = await fetch("/api/admin/ca", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password, ca }),
    });
    const payload = await readEnvelope<ContractAddressState & { live_in_seconds: number }>(response);
    if (!payload.success || !payload.data) {
      return {
        ok: false,
        error: payload.error ?? ({ code: "UNKNOWN", message: "Something went wrong." } as ApiError),
      };
    }
    return { ok: true, data: payload.data };
  } catch {
    return { ok: false, error: { code: "NETWORK", message: "Could not reach the server." } };
  }
}

export type SponsorLaunchStatus = {
  available: boolean;
  sponsor_address: string | null;
};

export type SponsorLaunchSocials = {
  twitter?: string;
  telegram?: string;
  discord?: string;
  website?: string;
  farcaster?: string;
};

export type SponsorLaunchRequest = {
  name: string;
  ticker: string;
  description: string;
  logo: string;
  socials?: SponsorLaunchSocials;
  creator_wallet: string;
  creator_tax_bps?: number;
  buyback_enabled?: boolean;
  /** Omit for the native ETH curve, or pass a verified stock's address. */
  pair_token?: string;
};

export type LaunchPair = {
  kind: "native" | "stock" | "unknown";
  symbol: string;
  name: string;
  address: string;
  decimals: number;
};

export type SponsorLaunchResult = {
  status: "confirmed" | "pending";
  tx_hash: string;
  token?: string;
  curve?: string;
  deployer?: string;
  pair?: LaunchPair;
  explorer_url: string;
};

export type VaultState = {
  /** True once there is a token to pay holders of. */
  live: boolean;
  /** True once a fee is switched on and the vault is filling up. */
  collecting: boolean;
  reason: string | null;
  token: string | null;
  vault: string | null;
  balance_wei: string;
  creator_fee_bps: number;
  holder_count: number;
  /** False when the holder scan was bounded, so counts are a floor, not a total. */
  complete_scan: boolean;
  block_number: number;
  distributed_wei: string;
  /** Where claims are sent. Null until a distributor is configured. */
  distributor: string | null;
};

/**
 * The rewards vault, read from the chain on every request.
 *
 * Returns null rather than a fabricated shape when it cannot be read: the
 * page shows "unknown" instead of a zero that would look like a fact.
 */
export async function fetchVaultState(
  options: { holders?: boolean; signal?: AbortSignal } = {},
): Promise<VaultState | null> {
  const { holders = true, signal } = options;
  try {
    const response = await fetch(`/api/vault?holders=${holders ? "1" : "0"}`, {
      cache: "no-store",
      signal: signal ?? AbortSignal.timeout(20_000),
    });
    const payload = await readEnvelope<VaultState>(response);
    if (!payload.success || !payload.data) return null;
    return payload.data;
  } catch {
    return null;
  }
}

export type RewardClaim = {
  round_id: number;
  asset: string;
  asset_symbol: string;
  asset_decimals: number;
  snapshot_block: number;
  index: number;
  account: string;
  amount_wei: string;
  proof: string[];
};

/**
 * What this wallet can claim, with the proof for each entry.
 *
 * Public and unauthenticated: an address's own payout is not a secret, and
 * the proof is worthless to anyone else -- the contract always pays the
 * account named in the leaf.
 */
export async function fetchRewardClaims(
  address: string,
  signal?: AbortSignal,
): Promise<RewardClaim[]> {
  try {
    const response = await fetch(`/api/vault/claims?address=${encodeURIComponent(address)}`, {
      cache: "no-store",
      signal: signal ?? AbortSignal.timeout(15_000),
    });
    const payload = await readEnvelope<{ claims: RewardClaim[] }>(response);
    if (!payload.success || !payload.data) return [];
    return payload.data.claims ?? [];
  } catch {
    return [];
  }
}

export type TokenizedStock = {
  symbol: string;
  name: string;
  address: string;
  decimals: number;
};

/**
 * The equities a launch may be paired against.
 *
 * Served from the same checked-in registry the server gates sponsored
 * launches on, so the picker cannot offer something the backend would then
 * refuse.
 */
export async function fetchStocks(signal?: AbortSignal): Promise<TokenizedStock[]> {
  try {
    const response = await fetch("/api/stocks", {
      cache: "no-store",
      signal: signal ?? AbortSignal.timeout(10_000),
    });
    const payload = await readEnvelope<{ stocks: TokenizedStock[] }>(response);
    if (!payload.success || !payload.data) return [];
    return payload.data.stocks ?? [];
  } catch {
    return [];
  }
}

/**
 * Whether Fons is currently paying launch fee + gas from its own wallet
 * instead of the visitor's. Off by default; only present at all once the
 * server has both the feature flag and the wallet key configured.
 */
export async function fetchSponsorLaunchStatus(signal?: AbortSignal): Promise<SponsorLaunchStatus> {
  try {
    const response = await fetch("/api/launch/sponsored/status", {
      cache: "no-store",
      signal: signal ?? AbortSignal.timeout(8_000),
    });
    const payload = await readEnvelope<SponsorLaunchStatus>(response);
    if (!payload.success || !payload.data) return { available: false, sponsor_address: null };
    return payload.data;
  } catch {
    return { available: false, sponsor_address: null };
  }
}

/**
 * The sponsored path: no MetaMask signature for the launch itself. Fons's
 * own wallet is the on-chain deployer; `creator_wallet` still receives any
 * creator-tax revenue the launch is configured to pay out.
 */
export async function submitSponsoredLaunch(
  body: SponsorLaunchRequest,
): Promise<{ ok: true; data: SponsorLaunchResult } | { ok: false; error: ApiError }> {
  try {
    const response = await fetch("/api/launch/sponsored", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = await readEnvelope<SponsorLaunchResult>(response);
    if (!payload.success || !payload.data) {
      return {
        ok: false,
        error: payload.error ?? ({ code: "UNKNOWN", message: "Something went wrong." } as ApiError),
      };
    }
    return { ok: true, data: payload.data };
  } catch {
    return { ok: false, error: { code: "NETWORK", message: "Could not reach the server." } };
  }
}

export type PreparedRound = {
  asset: string;
  asset_symbol: string;
  asset_decimals: number;
  root: string;
  total_wei: string;
  requested_wei: string;
  snapshot_block: number;
  recipient_count: number;
  payouts: Record<string, string>;
};

/*
  Working out a round, and filing it once it exists on chain.

  Deliberately two calls with a wallet transaction between them. Preparing
  moves no money and can be run as often as you like; publishing only records
  a round the chain already has, which is why it takes the round id the
  receipt reported rather than guessing at one.
*/
export async function prepareRewardRound(
  password: string,
  amountWei: string,
  asset: string,
): Promise<{ ok: true; data: PreparedRound } | { ok: false; error: ApiError }> {
  return postAdminJson<PreparedRound>("/api/admin/vault/round/prepare", {
    password,
    amount_wei: amountWei,
    asset,
  });
}

export async function publishRewardRound(
  password: string,
  round: {
    roundId: number;
    asset: string;
    root: string;
    snapshotBlock: number;
    payouts: Record<string, string>;
  },
): Promise<{ ok: true; data: { round_id: number } } | { ok: false; error: ApiError }> {
  return postAdminJson<{ round_id: number }>("/api/admin/vault/round/publish", {
    password,
    round_id: round.roundId,
    asset: round.asset,
    root: round.root,
    snapshot_block: round.snapshotBlock,
    payouts: round.payouts,
  });
}

async function postAdminJson<T>(
  path: string,
  body: Record<string, unknown>,
): Promise<{ ok: true; data: T } | { ok: false; error: ApiError }> {
  try {
    const response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = await readEnvelope<T>(response);
    if (!payload.success || !payload.data) {
      return {
        ok: false,
        error: payload.error ?? ({ code: "UNKNOWN", message: "Something went wrong." } as ApiError),
      };
    }
    return { ok: true, data: payload.data };
  } catch {
    return { ok: false, error: { code: "NETWORK", message: "Could not reach the server." } };
  }
}

export type PublicSettings = {
  distributor: string | null;
  token: string | null;
};

/**
 * The handful of addresses the browser needs at runtime.
 *
 * The distributor used to be a build-time variable, which meant changing it
 * needed a rebuild. Serving it means the admin panel can set it and the claim
 * button appears on the next page load.
 */
export async function fetchPublicSettings(signal?: AbortSignal): Promise<PublicSettings | null> {
  try {
    const response = await fetch("/api/settings", {
      cache: "no-store",
      signal: signal ?? AbortSignal.timeout(10_000),
    });
    const payload = await readEnvelope<PublicSettings>(response);
    if (!payload.success || !payload.data) return null;
    return payload.data;
  } catch {
    return null;
  }
}

export type AdminSettings = {
  stored: Record<string, string | number>;
  effective: {
    fons_token_address: string | null;
    fons_token_start_block: number;
    rewards_distributor_address: string | null;
    rewards_vault_address: string | null;
    creator_fee_bps: number;
  };
  live_in_seconds?: number;
};

/** Reading the panel is gated too: it reports where the fees go. */
export async function fetchAdminSettings(
  password: string,
): Promise<{ ok: true; data: AdminSettings } | { ok: false; error: ApiError }> {
  return postAdminJson<AdminSettings>("/api/admin/settings", { password, read_only: true });
}

export async function saveAdminSettings(
  password: string,
  patch: Record<string, string>,
): Promise<{ ok: true; data: AdminSettings } | { ok: false; error: ApiError }> {
  return postAdminJson<AdminSettings>("/api/admin/settings", { password, ...patch });
}

export type DetectedLaunch = {
  token: string;
  block_number: number;
  curve: string;
  deployer: string;
};

/**
 * Ask the chain when $FONS was launched.
 *
 * It launches through the same Pons factory as every other token on the
 * site, so the factory already recorded the block. Reading it beats asking
 * someone to copy it: a start block that is slightly wrong raises no error,
 * it just silently pays nothing to everyone who bought before it.
 */
export async function detectLaunchBlock(
  password: string,
  token?: string,
): Promise<{ ok: true; data: DetectedLaunch } | { ok: false; error: ApiError }> {
  return postAdminJson<DetectedLaunch>("/api/admin/settings", {
    password,
    detect: true,
    ...(token ? { token } : {}),
  });
}
