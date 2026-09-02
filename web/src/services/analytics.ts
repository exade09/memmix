const OPT_OUT_KEY = "mixborn.analytics.optout";
const ANON_KEY = "mixborn.analytics.anon";
const BUFFER_KEY = "mixborn.analytics.buffer";
const BLOCKED = /wallet|pubkey|publickey|secret|private|seed|mnemonic|signature|txbytes|transaction/;

export const ANALYTICS_EVENTS = [
  "landing_primary_cta",
  "landing_direct_launch_cta",
  "search_opened",
  "search_completed",
  "parent_selected_a",
  "parent_selected_b",
  "mix_requested",
  "mix_concepts_ready",
  "mix_concept_selected",
  "avatar_requested",
  "avatar_completed",
  "avatar_failed",
  "draft_sent_to_launch",
  "direct_launch_started",
  "launch_review_opened",
  "wallet_connect_requested",
  "launch_simulation_succeeded",
  "launch_simulation_failed",
  "wallet_signature_rejected",
  "launch_submitted",
  "launch_confirmed",
  "initial_buy_submitted",
  "initial_buy_skipped",
  "launch_reconciliation_needed",
  "external_market_opened",
] as const;

export type AnalyticsEvent = (typeof ANALYTICS_EVENTS)[number];

export function analyticsOptedOut(): boolean {
  try {
    return localStorage.getItem(OPT_OUT_KEY) === "1";
  } catch {
    return false;
  }
}

export function setAnalyticsOptOut(optOut: boolean): void {
  try {
    if (optOut) localStorage.setItem(OPT_OUT_KEY, "1");
    else localStorage.removeItem(OPT_OUT_KEY);
  } catch {
    /* analytics must never break the app */
  }
}

export function anonymousId(): string {
  try {
    const existing = sessionStorage.getItem(ANON_KEY);
    if (existing) return existing;
    const id = `anon_${Math.random().toString(36).slice(2, 10)}`;
    sessionStorage.setItem(ANON_KEY, id);
    return id;
  } catch {
    return "anon_ephemeral";
  }
}

export function sanitizeAnalyticsProps(input?: Record<string, unknown>): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  if (!input) return out;
  for (const [key, value] of Object.entries(input)) {
    if (BLOCKED.test(key.toLowerCase())) continue;
    if (typeof value === "string") {
      out[key] = value.slice(0, 80);
    } else if (typeof value === "number" && Number.isFinite(value)) {
      out[key] = value;
    } else if (typeof value === "boolean") {
      out[key] = value;
    }
  }
  return out;
}

export function track(event: AnalyticsEvent, props?: Record<string, unknown>): void {
  try {
    if (analyticsOptedOut()) return;
    const record = {
      event,
      t: Date.now(),
      anon: anonymousId(),
      ...sanitizeAnalyticsProps(props),
    };
    const raw = sessionStorage.getItem(BUFFER_KEY);
    const buffer = raw ? (JSON.parse(raw) as unknown[]) : [];
    const next = Array.isArray(buffer) ? [...buffer.slice(-49), record] : [record];
    sessionStorage.setItem(BUFFER_KEY, JSON.stringify(next));
    const endpoint = import.meta.env.VITE_ANALYTICS_URL;
    if (typeof endpoint === "string" && endpoint.startsWith("https://")) {
      navigator.sendBeacon?.(endpoint, JSON.stringify(record));
    }
  } catch {
    /* refuse analytics never breaks launch, mix, or browse */
  }
}
