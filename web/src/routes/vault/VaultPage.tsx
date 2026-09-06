import { useEffect, useState } from "react";
import { appConfig } from "../../app/config";
import { SiteFooter } from "../../components/layout/SiteFooter";
import { AnimatedText } from "../../components/motion/AnimatedText";
import { GlassMark } from "../../components/brand/GlassMark";
import { ButtonLink } from "../../components/ui/Button";
import { fetchContractAddress } from "../../services/api";

/*
  The rewards vault, described before it exists.

  Deliberately shows no balances, no yields and no "you have earned" figures.
  Nothing is accruing yet: $FONS has not launched, and sponsored launches
  currently set the creator tax to zero, so there is no fee stream to hold.
  Inventing a number here would be inventing income, which is the one thing
  this page must not do -- it is the same rule the rest of the site follows
  about unknown values.

  What it does instead is state the mechanism plainly and report, from real
  configuration, how far along it actually is.
*/

type Readiness = {
  tokenLive: boolean;
  /** The header CA, which is the honest signal for whether $FONS exists yet. */
  contractAddress: string;
};

export function VaultPage() {
  const [readiness, setReadiness] = useState<Readiness>({ tokenLive: false, contractAddress: "" });

  useEffect(() => {
    const controller = new AbortController();
    fetchContractAddress(controller.signal).then((state) => {
      const ca = (state.ca || "").trim();
      // "TBA", a note, or an empty value all mean the same thing: not live.
      const looksLikeAddress = /^0x[a-fA-F0-9]{40}$/.test(ca);
      setReadiness({ tokenLive: looksLikeAddress, contractAddress: ca });
    });
    return () => controller.abort();
  }, []);

  const steps: [string, string][] = [
    [
      "A launch pays a fee",
      "Every token launched through Fons carries the launch contract's own fee, and can carry a creator fee on each trade.",
    ],
    [
      "The fee reaches the vault",
      `Instead of going to one wallet, that stream is pointed at the vault: a single balance the platform does not spend on itself.`,
    ],
    [
      `Holders of $${appConfig.tokenSymbol} share it`,
      `What the vault holds is split across ${`$${appConfig.tokenSymbol}`} holders in proportion to how much they hold, on a fixed schedule.`,
    ],
  ];

  return (
    <>
      <div className="section">
        <div className="wrap legal-page">
          <p className="eyebrow">Rewards</p>
          <AnimatedText as="h1" reveal="lines" lines={["The vault"]} />
          <p className="body-copy">
            One balance, fed by launch activity, split across ${appConfig.tokenSymbol} holders. This page describes
            how it is built, and says plainly how much of it is live.
          </p>

          <div className="panel stack" style={{ marginTop: 8 }}>
            <p className="eyebrow">Status</p>
            <dl className="facts strong">
              <div>
                <dt>Vault</dt>
                <dd>Not live yet</dd>
              </div>
              <div>
                <dt>${appConfig.tokenSymbol}</dt>
                <dd>{readiness.tokenLive ? readiness.contractAddress : "Not launched"}</dd>
              </div>
              <div>
                <dt>Collecting fees</dt>
                <dd>No</dd>
              </div>
              <div>
                <dt>Distributed so far</dt>
                <dd>Nothing</dd>
              </div>
            </dl>
            <p className="metric-label">
              These are the real values, not placeholders. Nothing is accruing, so there is no balance to show and no
              rate to quote. When that changes, the numbers here will come from the chain rather than from this page.
            </p>
          </div>

          <h3>How it will work</h3>
          <ol className="doc-steps">
            {steps.map(([title, body], index) => (
              <li key={title}>
                <span className="doc-step-index">{String(index + 1).padStart(2, "0")}</span>
                <div>
                  <strong>{title}</strong>
                  <p>{body}</p>
                </div>
              </li>
            ))}
          </ol>

          <h3>What has to happen first</h3>
          <ul className="legal-list">
            <li>
              ${appConfig.tokenSymbol} has to exist. Until it is launched there is no holder list to split anything
              across.
            </li>
            <li>
              A creator fee has to be switched on. Sponsored launches currently set it to zero, so no trading fee is
              being collected at all today.
            </li>
            <li>
              The distributing wallet has to be set up and funded for gas, and its address published here so payouts
              can be checked on-chain rather than taken on trust.
            </li>
          </ul>

          <aside className="doc-note">
            This is a plan, not a promise of income. Fees only exist if people trade, the amount is whatever trading
            produces, and no figure on this page is a projection. Nothing here is financial advice.
          </aside>

          <div className="btn-row" style={{ marginTop: 8 }}>
            <ButtonLink to="/docs" variant="outline">
              Read the docs
            </ButtonLink>
            <ButtonLink to="/app/mix" variant="primary" arrow>
              Mix two tokens
            </ButtonLink>
          </div>

          <div style={{ display: "grid", placeItems: "center", marginTop: 8 }}>
            <GlassMark state="idle" className="sz-sm" quiet />
          </div>
        </div>
      </div>
      <SiteFooter />
    </>
  );
}
