import { useChain } from "../../chain/wallet";
import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { appConfig } from "../../app/config";
import { SafetyBanner } from "../../components/layout/SafetyBanner";
import { Button, ButtonAnchor, ButtonLink } from "../../components/ui/Button";
import { setDraftParent } from "../../domain/draft";
import { INDEXER_NOTICE, explorerTokenUrl, marketUrl } from "../../domain/legalCopy";
import { track } from "../../services/analytics";
import { fetchToken, TokenApiError, type TokenDetail } from "../../services/api";
import { readOnchainToken, type OnchainTokenView } from "../../chain/tokenOnchain";
import { TokenAvatar } from "../../components/token/TokenAvatar";
import { AnimatedText } from "../../components/motion/AnimatedText";

function metric(value?: number | null, kind: "money" | "percent" | "text" = "text"): string {
  if (value == null || Number.isNaN(value)) return "Unknown";
  if (kind === "money") {
    if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
    if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
    return `$${value.toFixed(0)}`;
  }
  if (kind === "percent") return `${value.toFixed(1)}%`;
  return String(value);
}



function parentCard(mint: string, label: string) {
  return {
    mint,
    name: label,
    symbol: "",
    source: "manual" as const,
  };
}

export function TokenPage() {
  const { mint = "" } = useParams();
  const navigate = useNavigate();
  const { publicClient } = useChain();
  const [detail, setDetail] = useState<TokenDetail | null>(null);
  const [onchain, setOnchain] = useState<OnchainTokenView | null>(null);
  const [error, setError] = useState("");
  const [errorCode, setErrorCode] = useState("");
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [onchainError, setOnchainError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    setErrorCode("");
    setDetail(null);
    setOnchain(null);
    setOnchainError(false);

    const api = fetchToken(mint)
      .then((payload) => {
        if (!cancelled) {
          setDetail(payload);
          setError("");
          setErrorCode("");
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof TokenApiError) {
          setErrorCode(err.code);
          setError(err.message);
        } else {
          setError(err instanceof Error ? err.message : "Token data is unavailable.");
        }
      });

    const chain = readOnchainToken(publicClient, mint)
      .then((payload: OnchainTokenView) => {
        if (!cancelled) setOnchain(payload);
      })
      .catch(() => {
        if (!cancelled) setOnchainError(true);
      });

    Promise.allSettled([api, chain]).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [publicClient, mint]);

  const mintExists = onchain ? onchain.exists : detail?.onchain.mint_exists === true;
  const exists = Boolean(mintExists || detail?.market);
  const notFound = !loading && errorCode === "TOKEN_NOT_FOUND" && !onchain?.exists;
  const name = onchain?.name || detail?.metadata.name || "Unknown";
  const symbol = onchain?.symbol || detail?.metadata.symbol || "Unknown";
  const image = detail?.metadata.image_url || "";
  const creator = detail?.onchain.creator || "Unknown";
  const lineage = detail?.lineage;
  const market = detail?.market;
  const notice = mintExists && !market
    ? INDEXER_NOTICE
    : !mintExists && !market && (detail || onchainError) && !notFound
      ? "On-chain lookup is delayed. Missing market data is not treated as a failed launch."
      : null;
  const partial = Boolean((exists || detail) && (onchainError || error) && !notFound);
  const showToken = !loading && (exists || Boolean(detail) || onchainError) && !notFound;

  const buyPlatform = useMemo(() => {
    const value = appConfig.platformTokenAddress.trim();
    return value || "";
  }, []);

  function copyMint() {
    void navigator.clipboard.writeText(mint);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  function useAs(side: "a" | "b") {
    setDraftParent(side, {
      mint,
      name: name === "Unknown" ? mint : name,
      symbol: symbol === "Unknown" ? "" : symbol,
      image_url: detail?.metadata.image_url || undefined,
      source: "dexscreener",
    });
    navigate("/app/mix");
  }

  function remixParents() {
    if (lineage?.parent_a) setDraftParent("a", parentCard(lineage.parent_a, "Token A"));
    if (lineage?.parent_b) setDraftParent("b", parentCard(lineage.parent_b, "Token B"));
    navigate("/app/mix");
  }

  if (notFound) {
    return (
      <section className="page token-page">
        <header className="page-head">
          <div className="stack sm">
            <p className="eyebrow">Public token</p>
            <AnimatedText as="h1" reveal="lines" lines={["Token not found"]} />
          </div>
        </header>
        <p className="empty-state">No contract was found at that address</p>
        <p className="metric-label">{mint}</p>
        <div className="btn-row">
          <ButtonLink to="/app/explore" variant="secondary">
            Explore
          </ButtonLink>
          <ButtonLink to="/app/mix" variant="ghost">
            Mix
          </ButtonLink>
        </div>
        <SafetyBanner />
      </section>
    );
  }

  return (
    <section className="page token-page">
      <header className="page-head">
        <div className="stack sm">
          <p className="eyebrow">Public token</p>
          {loading ? <AnimatedText as="h1" reveal="lines" lines={["Reading token data"]} /> : null}
        </div>
      </header>

      {!loading && !showToken && error ? <p className="note error">{error}</p> : null}
      {partial ? (
        <p className="note warn" role="status">
          Some sources are delayed. On-chain presence is not undone by missing market data.
        </p>
      ) : null}

      {showToken ? (
        <>
          <div className="panel token-hero">
            <TokenAvatar src={image} symbol={symbol} name={name} seed={mint} size={96} />
            <div className="stack sm token-hero-id">
              <h1>
                {name} <span className="token-hero-ticker">${symbol}</span>
              </h1>
              <p className="metric-label">{mint}</p>
              <div className="btn-row tight">
                <Button type="button" variant="outline" size="sm" onClick={copyMint}>
                  {copied ? "Copied" : "Copy address"}
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => useAs("a")}>
                  Use as Token A
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => useAs("b")}>
                  Use as Token B
                </Button>
              </div>
            </div>
          </div>

          <dl className="facts token-facts">
            <div>
              <dt>Creator</dt>
              <dd>{creator}</dd>
            </div>
            <div>
              <dt>Contract</dt>
              <dd>{onchain?.exists ? "Verified ERC-20" : "Unknown"}</dd>
            </div>
            <div>
              <dt>Decimals</dt>
              <dd>{onchain?.decimals ?? "Unknown"}</dd>
            </div>
            <div>
              <dt>Liquidity</dt>
              <dd>{metric(market?.liquidity_usd, "money")}</dd>
            </div>
            <div>
              <dt>Volume 24h</dt>
              <dd>{metric(market?.volume_24h_usd, "money")}</dd>
            </div>
            <div>
              <dt>1h</dt>
              <dd>{metric(market?.price_change_1h, "percent")}</dd>
            </div>
            <div>
              <dt>Authority</dt>
              <dd>Unknown</dd>
            </div>
            <div>
              <dt>Concentration</dt>
              <dd>Unknown</dd>
            </div>
          </dl>

          {notice ? (
            <p className="empty-state" role="status">
              {notice}
            </p>
          ) : null}

          {detail?.metadata.socials && detail.metadata.socials.length > 0 ? (
            <p className="btn-row tight">
              {detail.metadata.socials.map((item) => (
                <a key={`${item.type}-${item.url}`} className="chip" href={item.url} target="_blank" rel="noreferrer">
                  {item.type}
                </a>
              ))}
            </p>
          ) : null}

          {lineage?.parent_a || lineage?.parent_b ? (
            <div className="panel stack sm">
              <p className="eyebrow">Lineage</p>
              <p className="metric-label">
                Parent A {lineage.parent_a || "Unknown"} · Parent B {lineage.parent_b || "Unknown"}
              </p>
              <div className="btn-row">
                <Button type="button" variant="outline" size="sm" onClick={remixParents}>
                  Remix these parents
                </Button>
              </div>
            </div>
          ) : null}

          <div className="btn-row">
            <ButtonAnchor
              variant="primary"
              arrow
              href={marketUrl(mint)}
              target="_blank"
              rel="noreferrer"
              onClick={() => track("external_market_opened")}
            >
              View the market
            </ButtonAnchor>
            <ButtonAnchor variant="secondary" href={explorerTokenUrl(mint)} target="_blank" rel="noreferrer">
              View on Blockscout
            </ButtonAnchor>
            {market?.pair_url ? (
              <ButtonAnchor variant="ghost" href={market.pair_url} target="_blank" rel="noreferrer">
                DexScreener
              </ButtonAnchor>
            ) : null}
            {buyPlatform ? (
              <ButtonAnchor
                variant="ghost"
                href={marketUrl(buyPlatform)}
                target="_blank"
                rel="noreferrer"
                onClick={() => track("external_market_opened")}
              >
                Buy ${appConfig.tokenSymbol}
              </ButtonAnchor>
            ) : null}
          </div>

          <SafetyBanner />
        </>
      ) : null}
    </section>
  );
}
