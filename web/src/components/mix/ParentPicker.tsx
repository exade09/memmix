import { useEffect, useRef, useState } from "react";
import { Button, FileButton } from "../ui/Button";
import { SearchResultButton, toParent } from "../token/TokenFeedCard";
import { searchTokensResult, type TokenSummary } from "../../services/api";
import type { ParentToken } from "../../domain/draft";

const MINT_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function shortenMint(mint: string): string {
  if (mint.length <= 10) return mint;
  return `${mint.slice(0, 4)}…${mint.slice(-4)}`;
}

function money(value?: number | null): string {
  if (value == null || Number.isNaN(value)) return "Unknown";
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
}

export function ParentPicker({
  side,
  selected,
  otherMint,
  locked,
  onSelect,
  onClear,
  onReferenceFile,
}: {
  side: "a" | "b";
  selected: ParentToken | null;
  otherMint?: string;
  locked?: boolean;
  onSelect: (token: ParentToken) => void;
  onClear: () => void;
  onReferenceFile?: (file: File) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<TokenSummary[]>([]);
  const [error, setError] = useState("");
  const timer = useRef(0);
  const abort = useRef<AbortController | null>(null);
  const label = side === "a" ? "Parent A search" : "Parent B search";

  useEffect(() => {
    return () => {
      window.clearTimeout(timer.current);
      abort.current?.abort();
    };
  }, []);

  function onQuery(value: string) {
    setQuery(value);
    window.clearTimeout(timer.current);
    abort.current?.abort();
    const trimmed = value.trim();
    if (trimmed.length < 2 && !MINT_RE.test(trimmed)) {
      setResults([]);
      setError("");
      return;
    }
    timer.current = window.setTimeout(() => {
      void run(trimmed);
    }, 250);
  }

  async function run(value: string) {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    try {
      const result = await searchTokensResult(value, 8, controller.signal);
      setResults(result.items);
      setError(
        result.collision_warning ||
          (result.items.length === 0 ? "Nothing matched those filters. Loosen them a little." : ""),
      );
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setResults([]);
      setError(err instanceof Error ? err.message : "The scanner is offline. Try a mint address or retry.");
    }
  }

  function choose(token: TokenSummary) {
    if (!token.mint) return;
    if (otherMint && token.mint.toLowerCase() === otherMint.toLowerCase()) {
      setError("Parents must be different.");
      return;
    }
    onSelect(toParent(token));
    setQuery("");
    setResults([]);
    setError("");
  }

  if (selected) {
    return (
      <article className="slot is-picked" data-side={side}>
        <p className="slot-label">Parent {side.toUpperCase()}</p>
        <img
          className="avatar picked-avatar"
          src={selected.image_url || "/assets/brand/token-fallback.webp"}
          alt={`${selected.name} avatar`}
          width={96}
          height={96}
        />
        <div className="stack sm">
          <strong className="picked-name">
            {selected.name} <span className="metric-label">${selected.symbol}</span>
          </strong>
          <p className="metric-label">{shortenMint(selected.mint)}</p>
          <p className="metric-label">
            Liq {money(selected.liquidity_usd)} · Vol {money(selected.volume_24h_usd)}
          </p>
          {!selected.image_url ? (
            <p className="note warn">This token has no usable image. Upload one to continue.</p>
          ) : null}
        </div>
        <div className="btn-row tight">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => void navigator.clipboard.writeText(selected.mint)}
          >
            Copy mint
          </Button>
          <FileButton
            variant="ghost"
            size="sm"
            disabled={locked}
            onFile={(file) => onReferenceFile?.(file)}
          >
            {selected.image_url ? "Replace image" : "Upload image"}
          </FileButton>
          <Button type="button" variant="ghost" size="sm" disabled={locked} onClick={onClear}>
            Remove
          </Button>
        </div>
      </article>
    );
  }

  return (
    <div className="slot" data-side={side}>
      <p className="slot-label">Parent {side.toUpperCase()}</p>
      <label>
        <span className="sr-only">{label}</span>
        <input
          className="control"
          value={query}
          disabled={locked}
          onChange={(event) => onQuery(event.target.value)}
          placeholder="Name, ticker, mint or Pump link"
          autoComplete="off"
          spellCheck={false}
        />
      </label>
      <p className="metric-label">Search any live Solana token, or paste a mint</p>
      {error ? <p className="metric-label">{error}</p> : null}
      {results.length > 0 ? (
        <div className="slot-results" role="listbox" aria-label={label}>
          {results.map((token) => (
            <SearchResultButton key={token.mint || token.symbol} token={token} onSelect={choose} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
