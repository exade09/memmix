import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { GlassMark } from "../../components/brand/GlassMark";
import { SafetyBanner } from "../../components/layout/SafetyBanner";
import { Button, ButtonAnchor, ButtonLink } from "../../components/ui/Button";
import { setDraftParent } from "../../domain/draft";
import { explorerTokenUrl, explorerTxUrl, marketUrl, shareLaunchCopy } from "../../domain/legalCopy";
import { isPublicTxHash, readPendingLaunch } from "../../domain/pendingLaunch";
import { shortenAddress } from "../../chain/address";
import { track } from "../../services/analytics";

export function LaunchSuccessPage() {
  const [params] = useSearchParams();
  const token = params.get("token") || "";
  const pending = readPendingLaunch();
  const [copied, setCopied] = useState(false);
  const matchesPending = Boolean(pending?.token && pending.token.toLowerCase() === token.toLowerCase());
  const locallyConfirmed = matchesPending && pending?.state === "confirmed";
  const txHash = matchesPending && isPublicTxHash(pending?.tx_hash) ? pending.tx_hash : null;
  const name = (matchesPending && pending?.name) || "Unknown";
  const ticker = (matchesPending && pending?.ticker) || "Unknown";
  const avatar = (matchesPending && pending?.image_uri) || "/assets/brand/token-fallback.webp";
  const tradeUrl = token ? marketUrl(token) : "";
  const share = useMemo(
    () =>
      token
        ? shareLaunchCopy({
            name,
            ticker,
            tradeUrl,
            parentA: matchesPending ? pending?.parent_a : undefined,
            parentB: matchesPending ? pending?.parent_b : undefined,
          })
        : "",
    [matchesPending, token, name, pending?.parent_a, pending?.parent_b, tradeUrl, ticker],
  );

  function copyAddress() {
    if (!token) return;
    void navigator.clipboard.writeText(token);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  function useAs(side: "a" | "b") {
    if (!token) return;
    setDraftParent(side, {
      mint: token,
      name: name === "Unknown" ? token : name,
      symbol: ticker === "Unknown" ? "" : ticker,
      image_url: matchesPending ? pending?.image_uri : undefined,
      source: "manual",
    });
  }

  if (!token) {
    return (
      <section className="page success-page">
        <header className="page-head">
          <div className="stack sm">
            <p className="eyebrow">Launch</p>
            <h1>Waiting for a confirmed token</h1>
          </div>
          <GlassMark state="warning" quiet className="sz-sm" />
        </header>
        <p className="empty-state">A launch is not confirmed until the contract exists on-chain</p>
        <div className="btn-row">
          <ButtonLink to="/app/launch" variant="secondary">
            Back to launch
          </ButtonLink>
          <ButtonLink to="/app/explore" variant="ghost">
            Explore
          </ButtonLink>
        </div>
        <SafetyBanner showFee />
      </section>
    );
  }

  return (
    <section className="page success-page">
      <header className="page-head">
        <div className="stack sm">
          <p className="eyebrow">{locallyConfirmed ? "Launch confirmed" : "Address in URL"}</p>
          <h1>
            {locallyConfirmed ? "It is alive" : "Verify this address on-chain before you treat it as launched"}
          </h1>
        </div>
        <GlassMark state="launched" className="sz-md" />
      </header>

      <div className="panel token-hero">
        <img className="avatar" src={avatar} alt={`${name} avatar`} width={96} height={96} />
        <div className="stack sm token-hero-id">
          <h2>
            {name} <span className="token-hero-ticker">${ticker}</span>
          </h2>
          <p className="metric-label">{token}</p>
          <p className="metric-label">
            {locallyConfirmed ? "Receipt confirmed on Robinhood Chain" : "Status unknown until verified"}
          </p>
          <div className="btn-row tight">
            <Button type="button" variant="outline" size="sm" onClick={copyAddress}>
              {copied ? "Copied" : "Copy address"}
            </Button>
            {txHash ? (
              <a className="chip live" href={explorerTxUrl(txHash)} target="_blank" rel="noreferrer">
                Transaction {shortenAddress(txHash)}
              </a>
            ) : (
              <span className="metric-label">Transaction link unavailable in this tab</span>
            )}
          </div>
        </div>
      </div>

      <div className="btn-row">
        <ButtonAnchor
          variant="primary"
          arrow
          href={tradeUrl}
          target="_blank"
          rel="noreferrer"
          onClick={() => track("external_market_opened")}
        >
          View the market
        </ButtonAnchor>
        <ButtonAnchor variant="secondary" href={explorerTokenUrl(token)} target="_blank" rel="noreferrer">
          View on Blockscout
        </ButtonAnchor>
        <ButtonLink to={`/token/${token}`} variant="outline">
          Open FONS token page
        </ButtonLink>
        <ButtonAnchor
          variant="ghost"
          href={`https://x.com/intent/tweet?text=${encodeURIComponent(share)}`}
          target="_blank"
          rel="noreferrer"
        >
          Share on X
        </ButtonAnchor>
      </div>

      <div className="btn-row">
        <ButtonLink to="/app/mix" variant="secondary">
          Mix another
        </ButtonLink>
        <ButtonLink to="/app/explore" variant="ghost">
          Explore
        </ButtonLink>
        <ButtonLink to="/app/mix" variant="ghost" onClick={() => useAs("a")}>
          Use as Parent A
        </ButtonLink>
        <ButtonLink to="/app/mix" variant="ghost" onClick={() => useAs("b")}>
          Use as Parent B
        </ButtonLink>
      </div>

      <p className="metric-label">
        Indexers may take time to pick this token up. An on-chain receipt is not undone by missing market data
      </p>
      <SafetyBanner showFee />
    </section>
  );
}
