import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { setDraftParent } from "../../domain/draft";
import { rememberSearch, readRecentSearches, type RecentSearch } from "../../domain/recent";
import { searchTokensResult, type TokenSummary } from "../../services/api";
import { track } from "../../services/analytics";
import { toParent } from "../token/TokenFeedCard";
import { Button } from "../ui/Button";

export function GlobalSearchDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<TokenSummary[]>([]);
  const [warning, setWarning] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const [recents, setRecents] = useState<RecentSearch[]>(readRecentSearches);
  const timer = useRef(0);
  const abort = useRef<AbortController | null>(null);

  const rows = useMemo(() => {
    const exact = items.filter((item) => item.mint && query && item.mint.toLowerCase() === query.trim().toLowerCase());
    const rest = items.filter((item) => !exact.some((row) => row.mint === item.mint));
    return { exact, rest };
  }, [items, query]);

  const flat = useMemo(() => [...rows.exact, ...rows.rest], [rows]);

  useEffect(() => {
    if (!open) return;
    track("search_opened");
    setRecents(readRecentSearches());
    window.setTimeout(() => inputRef.current?.focus(), 20);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        inputRef.current?.blur();
        setActive((index) => Math.min(index + 1, Math.max(flat.length - 1, 0)));
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        inputRef.current?.blur();
        setActive((index) => Math.max(index - 1, 0));
      }
      const selected = flat[active];
      if (!selected) return;
      if (event.key === "Enter") {
        event.preventDefault();
        openToken(selected);
      }
      if (event.key.toLowerCase() === "a" && !isTyping(event)) {
        event.preventDefault();
        assign(selected, "a");
      }
      if (event.key.toLowerCase() === "b" && !isTyping(event)) {
        event.preventDefault();
        assign(selected, "b");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, flat, active, onClose]);

  function isTyping(event: KeyboardEvent) {
    const target = event.target as HTMLElement | null;
    return target?.tagName === "INPUT" || target?.tagName === "TEXTAREA";
  }

  function schedule(value: string) {
    setQuery(value);
    window.clearTimeout(timer.current);
    abort.current?.abort();
    if (value.trim().length < 2) {
      setItems([]);
      setWarning("");
      setError("");
      return;
    }
    timer.current = window.setTimeout(() => {
      void run(value);
    }, 250);
  }

  async function run(value: string) {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setLoading(true);
    try {
      const result = await searchTokensResult(value, 8, controller.signal);
      setItems(result.items);
      setWarning(result.collision_warning || "");
      setError(result.items.length === 0 ? "Nothing matched those filters. Loosen them a little." : "");
      setActive(0);
      track("search_completed", { empty: result.items.length === 0 });
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setItems([]);
      setError(err instanceof Error ? err.message : "The scanner is offline. Try a contract address or retry.");
    } finally {
      setLoading(false);
    }
  }

  function openToken(token: TokenSummary) {
    rememberSearch({ query: token.symbol || token.mint, mint: token.mint, name: token.name, symbol: token.symbol });
    onClose();
    navigate(`/token/${token.mint}`);
  }

  function assign(token: TokenSummary, side: "a" | "b") {
    if (!token.mint) return;
    setDraftParent(side, toParent(token));
    rememberSearch({ query: token.symbol || token.mint, mint: token.mint, name: token.name, symbol: token.symbol });
    onClose();
    navigate("/app/mix");
  }

  if (!open) return null;

  return (
    <div className="overlay top" role="presentation" onClick={onClose}>
      <div
        className="dialog search-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Quick search"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="search-dialog-input">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
            <circle cx="7" cy="7" r="4.6" />
            <path d="M10.4 10.4 14 14" strokeLinecap="round" />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => schedule(event.target.value)}
            placeholder="Name, ticker, address or DexScreener URL"
            aria-autocomplete="list"
          />
        </div>
        <div className="search-dialog-body">
          {loading ? <p className="metric-label">Searching…</p> : null}
          {warning ? <p className="note warn">{warning}</p> : null}
          {error ? <p className="metric-label">{error}</p> : null}
          {rows.exact.length > 0 ? (
            <section>
              <p className="search-group-label">Exact address</p>
              {rows.exact.map((token, index) => (
                <ResultRow
                  key={token.mint}
                  token={token}
                  active={active === index}
                  onOpen={() => openToken(token)}
                  onAssign={assign}
                />
              ))}
            </section>
          ) : null}
          {rows.rest.length > 0 ? (
            <section>
              <p className="search-group-label">Tokens by name / ticker</p>
              {rows.rest.map((token, index) => (
                <ResultRow
                  key={token.mint}
                  token={token}
                  active={active === index + rows.exact.length}
                  onOpen={() => openToken(token)}
                  onAssign={assign}
                />
              ))}
            </section>
          ) : null}
          {query.trim().length < 2 && recents.length > 0 ? (
            <section>
              <p className="search-group-label">Recent searches</p>
              {recents.map((item) => (
                <button
                  key={`${item.query}-${item.mint || ""}`}
                  type="button"
                  className="search-result"
                  onClick={() => {
                    if (item.mint) {
                      navigate(`/token/${item.mint}`);
                      onClose();
                      return;
                    }
                    schedule(item.query);
                  }}
                >
                  <span className="search-result-fallback" aria-hidden="true" />
                  <span>{item.name ? `${item.name} $${item.symbol}` : item.query}</span>
                </button>
              ))}
            </section>
          ) : null}
          {query.trim().length < 2 && recents.length === 0 ? (
            <p className="empty-state">No recent mutations yet.</p>
          ) : null}
        </div>
        <p className="search-help metric-label">↑↓ select · Enter view · A / B assign parent · Esc close</p>
      </div>
    </div>
  );
}

function ResultRow({
  token,
  active,
  onOpen,
  onAssign,
}: {
  token: TokenSummary;
  active: boolean;
  onOpen: () => void;
  onAssign: (token: TokenSummary, side: "a" | "b") => void;
}) {
  return (
    <div className={`search-row${active ? " is-active" : ""}`}>
      <button type="button" className="search-result" onClick={onOpen}>
        <img src={token.image_url || "/assets/brand/token-fallback.webp"} alt="" width={30} height={30} />
        <span>
          <strong>{token.name}</strong>
          <em>${token.symbol}</em>
        </span>
      </button>
      {token.mint ? (
        <span className="btn-row tight">
          <Button type="button" variant="ghost" size="sm" onClick={() => onAssign(token, "a")}>
            A
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => onAssign(token, "b")}>
            B
          </Button>
        </span>
      ) : null}
    </div>
  );
}
