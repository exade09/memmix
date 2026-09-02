import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { appConfig } from "../../app/config";
import { GlassMark } from "../../components/brand/GlassMark";
import { SafetyBanner } from "../../components/layout/SafetyBanner";
import { Button, ButtonAnchor, ButtonLink } from "../../components/ui/Button";
import { setDraftParent } from "../../domain/draft";
import {
  pumpCoinUrl,
  shareLaunchCopy,
  solscanAccountUrl,
  solscanTxUrl,
} from "../../domain/legalCopy";
import { isPublicSignature, readPendingLaunch } from "../../domain/pendingLaunch";
import { track } from "../../services/analytics";

export function LaunchSuccessPage() {
  const [params] = useSearchParams();
  const mint = params.get("mint") || "";
  const pending = readPendingLaunch();
  const [copied, setCopied] = useState(false);
  const matchesPending = Boolean(pending?.mint && pending.mint === mint);
  const locallyConfirmed = matchesPending && pending?.state === "confirmed";
  const signature = matchesPending && isPublicSignature(pending?.signature) ? pending.signature : null;
  const name = (matchesPending && pending?.name) || "Unknown";
  const ticker = (matchesPending && pending?.ticker) || "Unknown";
  const avatar = (matchesPending && pending?.image_uri) || "/assets/brand/mark-merge-o.svg";
  const pumpUrl = mint ? pumpCoinUrl(mint) : "";
  const share = useMemo(
    () =>
      mint
        ? shareLaunchCopy({
            name,
            ticker,
            pumpUrl,
            parentA: matchesPending ? pending?.parent_a : undefined,
            parentB: matchesPending ? pending?.parent_b : undefined,
          })
        : "",
    [matchesPending, mint, name, pending?.parent_a, pending?.parent_b, pumpUrl, ticker],
  );

  function copyMint() {
    if (!mint) return;
    void navigator.clipboard.writeText(mint);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  function useAs(side: "a" | "b") {
    if (!mint) return;
    setDraftParent(side, {
      mint,
      name: name === "Unknown" ? mint : name,
      symbol: ticker === "Unknown" ? "" : ticker,
      image_url: matchesPending ? pending?.image_uri : undefined,
      source: "manual",
    });
  }

  if (!mint) {
    return (
      <section className="page success-page">
        <header className="page-head">
          <div className="stack sm">
            <p className="eyebrow">Launch</p>
            <h1>Waiting for a confirmed mint</h1>
          </div>
          <GlassMark state="warning" quiet className="sz-sm" />
        </header>
        <p className="empty-state">A launch is not confirmed until the mint exists on-chain.</p>
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
          <p className="eyebrow">{locallyConfirmed ? "Launch confirmed" : "Mint in URL"}</p>
          <h1>
            {locallyConfirmed ? "It is alive" : "Verify this mint on-chain before you treat it as launched"}
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
          <p className="metric-label">{mint}</p>
          <p className="metric-label">
            {locallyConfirmed ? "Bonding curve status: Live on curve" : "Bonding curve status: Unknown until verified"}
          </p>
          <div className="btn-row tight">
            <Button type="button" variant="outline" size="sm" onClick={copyMint}>
              {copied ? "Copied" : "Copy mint"}
            </Button>
            {signature ? (
              <a
                className="chip live"
                href={solscanTxUrl(signature, appConfig.cluster)}
                target="_blank"
                rel="noreferrer"
              >
                Confirmed transaction
              </a>
            ) : (
              <span className="metric-label">Transaction link unavailable in this tab.</span>
            )}
          </div>
        </div>
      </div>

      <div className="btn-row">
        <ButtonAnchor
          variant="primary"
          arrow
          href={pumpUrl}
          target="_blank"
          rel="noreferrer"
          onClick={() => track("external_pump_opened")}
        >
          View on Pump
        </ButtonAnchor>
        <ButtonAnchor
          variant="secondary"
          href={solscanAccountUrl(mint, appConfig.cluster)}
          target="_blank"
          rel="noreferrer"
        >
          View on Solscan
        </ButtonAnchor>
        <ButtonLink to={`/token/${mint}`} variant="outline">
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
        DexScreener may take time to index this mint. On-chain confirmation is not undone by missing market data.
      </p>
      <SafetyBanner showFee />
    </section>
  );
}
