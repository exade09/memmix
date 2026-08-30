export type DraftToken = {
  source: "ai_mix" | "direct";
  name: string;
  ticker: string;
  description: string;
  avatar_url?: string;
  twitter?: string;
  telegram?: string;
  website?: string;
  parent_a_mint?: string;
  parent_b_mint?: string;
  mix_strategy?: string;
  generated?: boolean;
  initial_buy_sol?: string;
};

const PUBLIC_KEYS = [
  "source",
  "name",
  "ticker",
  "description",
  "avatar_url",
  "twitter",
  "telegram",
  "website",
  "parent_a_mint",
  "parent_b_mint",
  "mix_strategy",
  "generated",
  "initial_buy_sol",
] as const;

export function isPublicImageUrl(url: string | undefined): boolean {
  const value = (url || "").trim();
  if (!value) return false;
  if (value.startsWith("blob:") || value.startsWith("data:")) return false;
  return value.startsWith("https://") || value.startsWith("http://");
}

export function persistableDraftToken(draft: DraftToken): DraftToken {
  const url = isPublicImageUrl(draft.avatar_url) ? draft.avatar_url : undefined;
  return {
    source: draft.source,
    name: draft.name,
    ticker: draft.ticker,
    description: draft.description,
    ...(url ? { avatar_url: url } : {}),
    ...(draft.twitter ? { twitter: draft.twitter } : {}),
    ...(draft.telegram ? { telegram: draft.telegram } : {}),
    ...(draft.website ? { website: draft.website } : {}),
    ...(draft.parent_a_mint ? { parent_a_mint: draft.parent_a_mint } : {}),
    ...(draft.parent_b_mint ? { parent_b_mint: draft.parent_b_mint } : {}),
    ...(draft.mix_strategy ? { mix_strategy: draft.mix_strategy } : {}),
    generated: Boolean(draft.generated),
    initial_buy_sol: draft.initial_buy_sol && draft.initial_buy_sol !== "0" ? draft.initial_buy_sol : "0",
  };
}

export function missingAvatarAfterReload(storedUrl: string | undefined, hasMemoryBlob: boolean): boolean {
  return !hasMemoryBlob && !isPublicImageUrl(storedUrl);
}

export function stripNonPublicDraft(raw: unknown): DraftToken | null {
  if (!raw || typeof raw !== "object") return null;
  const input = raw as Record<string, unknown>;
  const next: DraftToken = {
    source: input.source === "ai_mix" ? "ai_mix" : "direct",
    name: String(input.name || ""),
    ticker: String(input.ticker || ""),
    description: String(input.description || ""),
  };
  for (const key of PUBLIC_KEYS) {
    if (key === "source" || key === "name" || key === "ticker" || key === "description") continue;
    const value = input[key];
    if (key === "generated") next.generated = Boolean(value);
    else if (key === "avatar_url" && typeof value === "string" && isPublicImageUrl(value)) next.avatar_url = value;
    else if (typeof value === "string" && value && key !== "avatar_url") (next as Record<string, unknown>)[key] = value;
  }
  return next;
}
