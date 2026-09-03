import { persistableDraftToken, stripNonPublicDraft } from "./handoff";
import { track } from "../services/analytics";

export type ParentToken = {
  mint: string;
  name: string;
  symbol: string;
  image_url?: string;
  description?: string;
  liquidity_usd?: number;
  volume_24h_usd?: number;
  price_change_1h?: number;
  created_at?: string | number | null;
  source?: "dexscreener" | "bundled" | "manual";
};

export type MixConcept = {
  id: "c1" | "c2" | "c3" | string;
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

export type MixState =
  | "EMPTY"
  | "ONE_PARENT_SELECTED"
  | "READY_TO_MUTATE"
  | "ANALYZING_IDENTITIES"
  | "CONCEPTS_READY"
  | "RESULT_READY"
  | "RECOVERABLE_ERROR";

const DRAFT_KEY = "mixborn.draftMix";
const TOKEN_KEY = "mixborn.draftToken";

export type DraftMix = {
  parent_a: ParentToken | null;
  parent_b: ParentToken | null;
  concepts?: MixConcept[];
  selected_concept_id?: string | null;
  fallback?: boolean;
  fallback_notice?: string | null;
  avatar_job_token?: string | null;
  avatar_result_url?: string | null;
  avatar_next_base?: "a" | "b" | null;
};

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

export function readDraftMix(): DraftMix {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    if (!raw) return { parent_a: null, parent_b: null };
    const parsed = JSON.parse(raw) as DraftMix;
    return {
      parent_a: parsed.parent_a ?? null,
      parent_b: parsed.parent_b ?? null,
      concepts: parsed.concepts ?? [],
      selected_concept_id: parsed.selected_concept_id ?? null,
      fallback: parsed.fallback ?? false,
      fallback_notice: parsed.fallback_notice ?? null,
      avatar_job_token: parsed.avatar_job_token ?? null,
      avatar_result_url: parsed.avatar_result_url ?? null,
      avatar_next_base:
        parsed.avatar_next_base === "a" || parsed.avatar_next_base === "b"
          ? parsed.avatar_next_base
          : null,
    };
  } catch {
    return { parent_a: null, parent_b: null };
  }
}

export function writeDraftMix(draft: DraftMix): void {
  const avatarUrl = draft.avatar_result_url?.startsWith("http") ? draft.avatar_result_url : null;
  sessionStorage.setItem(
    DRAFT_KEY,
    JSON.stringify({
      parent_a: draft.parent_a,
      parent_b: draft.parent_b,
      concepts: draft.concepts ?? [],
      selected_concept_id: draft.selected_concept_id ?? null,
      fallback: draft.fallback ?? false,
      fallback_notice: draft.fallback_notice ?? null,
      avatar_job_token: draft.avatar_job_token ?? null,
      avatar_result_url: avatarUrl,
      avatar_next_base:
        draft.avatar_next_base === "a" || draft.avatar_next_base === "b"
          ? draft.avatar_next_base
          : null,
    }),
  );
}

export function setDraftParent(side: "a" | "b", token: ParentToken | null): DraftMix {
  const current = readDraftMix();
  const previous = side === "a" ? current.parent_a : current.parent_b;
  const parentChanged =
    (previous?.mint || "").toLowerCase() !== (token?.mint || "").toLowerCase();
  const withParent =
    side === "a" ? { ...current, parent_a: token } : { ...current, parent_b: token };
  const next = parentChanged
    ? {
        ...withParent,
        concepts: [],
        selected_concept_id: null,
        fallback: false,
        fallback_notice: null,
        avatar_job_token: null,
        avatar_result_url: null,
        avatar_next_base: "a" as const,
      }
    : withParent;
  writeDraftMix(next);
  if (token) track(side === "a" ? "parent_selected_a" : "parent_selected_b");
  return next;
}

export function readDraftToken(): DraftToken | null {
  try {
    const raw = sessionStorage.getItem(TOKEN_KEY);
    if (!raw) return null;
    return stripNonPublicDraft(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function writeDraftToken(draft: DraftToken): void {
  sessionStorage.setItem(TOKEN_KEY, JSON.stringify(persistableDraftToken(draft)));
}

export function mixState(input: {
  parentA: ParentToken | null;
  parentB: ParentToken | null;
  analyzing: boolean;
  concepts: MixConcept[];
  selectedId: string | null;
  error: string;
}): MixState {
  if (input.analyzing) return "ANALYZING_IDENTITIES";
  if (input.error && input.concepts.length === 0) return "RECOVERABLE_ERROR";
  if (input.concepts.length === 3 && input.selectedId) return "RESULT_READY";
  if (input.concepts.length === 3) return "CONCEPTS_READY";
  if (input.parentA && input.parentB) return "READY_TO_MUTATE";
  if (input.parentA || input.parentB) return "ONE_PARENT_SELECTED";
  return "EMPTY";
}
