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
