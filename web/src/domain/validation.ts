import { z } from "zod";

const TICKER_RE = /^[A-Z0-9]{1,6}$/;
const SOCIAL_URL_MAX = 200;
const TWITTER_HOSTS = new Set(["x.com", "www.x.com", "twitter.com", "www.twitter.com"]);
const TELEGRAM_HOSTS = new Set(["t.me", "www.t.me", "telegram.me", "www.telegram.me"]);

export const NAME_MIN = 2;
export const NAME_MAX = 32;
export const TICKER_MAX = 6;
export const DESCRIPTION_MIN = 1;
export const DESCRIPTION_MAX = 500;
export const INITIAL_BUY_DEFAULT = "0";
export const INITIAL_BUY_PRESETS = ["0", "0.05", "0.1", "0.25"] as const;

const tickerSchema = z.string().regex(TICKER_RE);
const nameSchema = z.string().min(NAME_MIN).max(NAME_MAX);
const descriptionSchema = z.string().min(DESCRIPTION_MIN).max(DESCRIPTION_MAX);

export function normalizeTicker(value: string): string {
  return value.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, TICKER_MAX);
}

export function isValidTicker(value: string): boolean {
  return tickerSchema.safeParse(normalizeTicker(value)).success;
}

export function isValidName(value: string): boolean {
  return nameSchema.safeParse(value.trim()).success;
}

export function isValidDescription(value: string): boolean {
  return descriptionSchema.safeParse(value.trim()).success;
}

export function clampScore(score: number): number {
  if (!Number.isFinite(score)) return 0;
  return Math.min(100, Math.max(0, score));
}

function parseHttps(value: string): URL | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    const host = url.hostname.toLowerCase();
    if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) {
      return null;
    }
    if (host === "0.0.0.0" || host.startsWith("127.") || host.startsWith("10.") || host.startsWith("192.168.")) {
      return null;
    }
    if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) return null;
    return url;
  } catch {
    return null;
  }
}

export function twitterError(value: string): string | null {
  const text = value.trim();
  if (!text) return null;
  if (text.length > SOCIAL_URL_MAX) return "That link is too long.";
  const url = parseHttps(text);
  if (!url || !TWITTER_HOSTS.has(url.hostname.toLowerCase())) {
    return "X link must be an https x.com or twitter.com URL.";
  }
  if (!url.pathname.replaceAll("/", "")) return "X link must include a profile path.";
  return null;
}

export function telegramError(value: string): string | null {
  const text = value.trim();
  if (!text) return null;
  if (text.length > SOCIAL_URL_MAX) return "That link is too long.";
  const url = parseHttps(text);
  if (!url || !TELEGRAM_HOSTS.has(url.hostname.toLowerCase())) {
    return "Telegram link must be an https t.me or telegram.me URL.";
  }
  if (!url.pathname.replaceAll("/", "")) return "Telegram link must include a channel or username.";
  return null;
}

export function websiteError(value: string): string | null {
  const text = value.trim();
  if (!text) return null;
  if (text.length > SOCIAL_URL_MAX) return "That link is too long.";
  const url = parseHttps(text);
  if (!url || !url.hostname.includes(".")) {
    return "Website must be a public https URL.";
  }
  return null;
}

export function normalizeInitialBuy(value: string): string {
  const text = value.trim() || INITIAL_BUY_DEFAULT;
  if (!/^\d+(\.\d{1,18})?$/.test(text)) return text;
  if (text === "0" || /^0+$/.test(text)) return "0";
  if (text.includes(".")) return text.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
  return text;
}

export function initialBuyError(value: string, maxEth: number): string | null {
  const text = value.trim() || INITIAL_BUY_DEFAULT;
  if (!/^\d+(\.\d{1,18})?$/.test(text)) return "Initial buy must be an ETH amount.";
  const amount = Number(text);
  if (!Number.isFinite(amount) || amount < 0) return "Initial buy must be an ETH amount.";
  if (amount > maxEth) return `Initial buy cannot exceed ${maxEth} ETH.`;
  return null;
}

export function formatEth(value: string): string {
  const normalized = normalizeInitialBuy(value);
  if (initialBuyError(normalized, Number.POSITIVE_INFINITY)) return `${value} ETH`;
  return `${normalized} ETH`;
}
