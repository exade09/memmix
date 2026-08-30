export type RecentSearch = {
  query: string;
  mint?: string;
  name?: string;
  symbol?: string;
};

const KEY = "mixborn.recentSearches";
const MAX = 10;

export function readRecentSearches(): RecentSearch[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as RecentSearch[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item) => item && typeof item.query === "string").slice(0, MAX);
  } catch {
    return [];
  }
}

export function rememberSearch(entry: RecentSearch): RecentSearch[] {
  const query = entry.query.trim();
  if (!query) return readRecentSearches();
  const next = [
    { ...entry, query },
    ...readRecentSearches().filter((item) => item.query.toLowerCase() !== query.toLowerCase() && item.mint !== entry.mint),
  ].slice(0, MAX);
  localStorage.setItem(KEY, JSON.stringify(next));
  return next;
}
