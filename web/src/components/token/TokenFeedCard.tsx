import { Link } from "react-router-dom";
import { motion, useReducedMotion } from "motion/react";
import { setDraftParent, type ParentToken } from "../../domain/draft";
import { clampScore } from "../../domain/validation";
import type { TokenSummary } from "../../services/api";
import { Button, ButtonLink } from "../ui/Button";
import { TokenAvatar } from "./TokenAvatar";

function ageLabel(minutes?: number | null): string {
  if (minutes == null) return "Unknown";
  if (minutes < 60) return `${Math.round(minutes)}m`;
  if (minutes < 1440) return `${(minutes / 60).toFixed(1)}h`;
  return `${(minutes / 1440).toFixed(1)}d`;
}

function money(value?: number | null): string {
  if (value == null || Number.isNaN(value)) return "Unknown";
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
}

function percent(value?: number | null): string {
  if (value == null || Number.isNaN(value)) return "Unknown";
  return `${value.toFixed(1)}%`;
}

export function toParent(token: TokenSummary): ParentToken {
  return {
    mint: token.mint,
    name: token.name,
    symbol: token.symbol,
    image_url: token.image_url,
    liquidity_usd: token.liquidity_usd ?? undefined,
    volume_24h_usd: token.volume_24h_usd ?? undefined,
    price_change_1h: token.price_change_1h ?? undefined,
    created_at: token.created_at,
    source: token.source,
  };
}

export function TokenFeedCard({
  token,
  assignedSide,
  onAssign,
}: {
  token: TokenSummary;
  assignedSide?: "a" | "b" | null;
  onAssign?: (side: "a" | "b", token: TokenSummary) => void;
}) {
  const reduceMotion = useReducedMotion();
  const risks = token.risk_flags ?? [];
  const consumed = assignedSide === "a" || assignedSide === "b";
  const canAssign = Boolean(token.mint);

  function assign(side: "a" | "b") {
    if (!canAssign) return;
    if (onAssign) {
      onAssign(side, token);
      return;
    }
    setDraftParent(side, toParent(token));
  }

  return (
    <motion.article
      className={`token-card${assignedSide === "a" ? " is-a" : ""}${assignedSide === "b" ? " is-b" : ""}`}
      animate={consumed && !reduceMotion ? { scale: 1.015 } : { scale: 1 }}
      transition={{ duration: 0.22, ease: [0.32, 0.72, 0, 1] }}
    >
      {consumed ? (
        <span className={`token-card-flag ${assignedSide}`}>Token {assignedSide?.toUpperCase()}</span>
      ) : null}
      <div className="token-card-head">
        <TokenAvatar
          src={token.image_url}
          symbol={token.symbol}
          name={token.name}
          seed={token.mint}
          size={48}
          layoutId={consumed || !token.mint ? undefined : `token-${token.mint}`}
        />
        <div className="token-card-id">
          <strong>{token.name}</strong>
          <span className="metric-label">
            ${token.symbol} · {ageLabel(token.age_minutes)}
            {token.score != null ? ` · score ${clampScore(token.score).toFixed(0)}` : ""}
          </span>
        </div>
        {token.source === "bundled" ? <span className="chip">Cached</span> : null}
      </div>

      <dl className="token-card-metrics">
        <div>
          <dt>Mcap</dt>
          <dd>{money(token.market_cap)}</dd>
        </div>
        <div>
          <dt>Liq</dt>
          <dd>{money(token.liquidity_usd)}</dd>
        </div>
        <div>
          <dt>Vol 24h</dt>
          <dd>{money(token.volume_24h_usd)}</dd>
        </div>
        <div>
          <dt>1h</dt>
          <dd>{percent(token.price_change_1h)}</dd>
        </div>
      </dl>

      <div className="token-card-risks">
        {risks.length > 0 ? (
          risks.slice(0, 3).map((risk) => (
            <span key={risk} className="chip warn">
              {risk}
            </span>
          ))
        ) : (
          <span className="metric-label">Risk unknown</span>
        )}
      </div>

      <div className="token-card-actions">
        {canAssign ? (
          onAssign ? (
            <>
              <Button type="button" variant="outline" size="sm" onClick={() => assign("a")}>
                Use as A
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => assign("b")}>
                Use as B
              </Button>
            </>
          ) : (
            <>
              <ButtonLink to="/app/mix" variant="outline" size="sm" onClick={() => assign("a")}>
                Use as A
              </ButtonLink>
              <ButtonLink to="/app/mix" variant="outline" size="sm" onClick={() => assign("b")}>
                Use as B
              </ButtonLink>
            </>
          )
        ) : (
          <span className="metric-label">Mint unknown</span>
        )}
        {token.mint ? (
          <Link to={`/token/${token.mint}`} className="token-card-view">
            View
          </Link>
        ) : null}
      </div>
    </motion.article>
  );
}

export function SearchResultButton({
  token,
  onSelect,
  layoutId,
}: {
  token: TokenSummary;
  onSelect: (token: TokenSummary) => void;
  layoutId?: string;
}) {
  return (
    <button type="button" className="search-result" onClick={() => onSelect(token)}>
      <TokenAvatar
        src={token.image_url}
        symbol={token.symbol}
        name={token.name}
        seed={token.mint}
        size={30}
        layoutId={layoutId}
      />
      <span>
        <strong>{token.name}</strong>
        <em>${token.symbol}</em>
      </span>
    </button>
  );
}

export function TokenSkeleton() {
  return <article className="token-card is-skeleton" aria-hidden="true" />;
}
