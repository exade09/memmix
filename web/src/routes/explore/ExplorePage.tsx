import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { TokenFeedCard, TokenSkeleton } from "../../components/token/TokenFeedCard";
import { Button } from "../../components/ui/Button";
import { rememberSearch } from "../../domain/recent";
import { fetchFeedResult, searchTokensResult, type TokenSummary } from "../../services/api";

const AGE_OPTIONS = [
  { label: "Any", value: "" },
  { label: "under 1h", value: "1" },
  { label: "under 6h", value: "6" },
  { label: "under 24h", value: "24" },
] as const;

export function ExplorePage() {
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState<"trending" | "new" | "mixable">("trending");
  const [tokens, setTokens] = useState<TokenSummary[]>([]);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [warning, setWarning] = useState("");
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState("");
  const [cached, setCached] = useState(false);
  const [age, setAge] = useState("");
  const [minLiquidity, setMinLiquidity] = useState("");
  const [minVolume, setMinVolume] = useState("");
  const [hasImage, setHasImage] = useState(false);
  const [searching, setSearching] = useState(false);

  const filtersActive = Boolean(age || minLiquidity || minVolume || hasImage);

  const feedQuery = useMemo(
    () => ({
      tab,
      limit: 24,
      min_liquidity: minLiquidity ? Number(minLiquidity) : undefined,
      min_volume: minVolume ? Number(minVolume) : undefined,
      max_age_hours: age ? Number(age) : undefined,
      has_image: hasImage ? true : undefined,
    }),
    [tab, minLiquidity, minVolume, age, hasImage],
  );

  useEffect(() => {
    if (params.get("search") === "1") {
      window.setTimeout(() => document.getElementById("explore-search")?.focus(), 40);
    }
  }, [params]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setSearching(false);
    fetchFeedResult(feedQuery)
      .then((result) => {
        if (cancelled) return;
        setTokens(result.tokens);
        setUpdatedAt(result.generated_at || "");
        setCached(result.data_source === "local-fallback");
        setError("");
        setWarning("");
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Feed unavailable");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [feedQuery]);

  async function onSearch(event: FormEvent) {
    event.preventDefault();
    setSearching(true);
    setLoading(true);
    try {
      const result = await searchTokensResult(query);
      setTokens(result.items);
      setWarning(result.collision_warning || "");
      setError("");
      setCached(false);
      rememberSearch({ query });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "The scanner is offline. Try a mint address or retry.");
    } finally {
      setLoading(false);
    }
  }

  function clearFilters() {
    setAge("");
    setMinLiquidity("");
    setMinVolume("");
    setHasImage(false);
    setSearching(false);
    setParams({});
  }

  return (
    <section className="page explore-page">
      <header className="page-head">
        <div className="stack sm">
          <p className="eyebrow">Discovery</p>
          <h1>Explore what is already alive</h1>
        </div>
        <div className="segmented" role="group" aria-label="Feed filter">
          {(["trending", "new", "mixable"] as const).map((item) => (
            <button key={item} type="button" aria-pressed={tab === item} onClick={() => setTab(item)}>
              {item}
            </button>
          ))}
        </div>
      </header>

      <form className="explore-search" onSubmit={onSearch}>
        <input
          id="explore-search"
          className="control"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Name, ticker, mint, Pump or DexScreener URL"
        />
        <Button type="submit" variant="secondary">
          Search
        </Button>
      </form>

      <div className="filter-bar">
        <label className="field">
          <span>Age</span>
          <select className="control" value={age} onChange={(event) => setAge(event.target.value)}>
            {AGE_OPTIONS.map((option) => (
              <option key={option.label} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Min liquidity</span>
          <input
            className="control"
            value={minLiquidity}
            onChange={(event) => setMinLiquidity(event.target.value)}
            inputMode="numeric"
            placeholder="USD"
          />
        </label>
        <label className="field">
          <span>Min volume</span>
          <input
            className="control"
            value={minVolume}
            onChange={(event) => setMinVolume(event.target.value)}
            inputMode="numeric"
            placeholder="USD"
          />
        </label>
        <label className="confirm-row filter-check">
          <input type="checkbox" checked={hasImage} onChange={(event) => setHasImage(event.target.checked)} />
          Has image
        </label>
      </div>

      <div className="feed-meta">
        {updatedAt ? <span className="metric-label">Last updated {updatedAt}</span> : null}
        {cached ? <span className="chip warn">Cached examples, not live market data</span> : null}
      </div>

      {warning ? <p className="note warn">{warning}</p> : null}
      {error ? <p className="note error">{error}</p> : null}
      {!loading && tokens.length === 0 && !error ? (
        <p className="empty-state">
          Nothing matched those filters. Loosen them a little.{" "}
          {filtersActive || searching ? (
            <Button type="button" variant="ghost" size="sm" onClick={clearFilters}>
              Clear filters
            </Button>
          ) : null}
        </p>
      ) : null}

      <div className="feed-grid" aria-busy={loading || undefined}>
        {loading
          ? Array.from({ length: 6 }, (_, index) => <TokenSkeleton key={index} />)
          : tokens.map((token, index) => (
              <TokenFeedCard key={token.mint || `${token.symbol}-${index}`} token={token} />
            ))}
      </div>
    </section>
  );
}
