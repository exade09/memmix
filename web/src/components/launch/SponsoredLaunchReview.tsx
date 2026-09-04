import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Address } from "viem";
import { AnimatedText } from "../motion/AnimatedText";
import { readPendingLaunch, writePendingLaunch } from "../../domain/pendingLaunch";
import { formatEth } from "../../domain/validation";
import { submitSponsoredLaunch } from "../../services/api";
import { useChain } from "../../chain/wallet";
import { ethToWei } from "../../chain/units";
import { submitInitialBuy } from "../../chain/launchpad";
import { Button } from "../ui/Button";
import { GlassMark } from "../brand/GlassMark";
import { track } from "../../services/analytics";

/*
  The zero-wallet path: Fons's own wallet pays the launch fee and gas, so
  there is no MetaMask signature for the launch itself. Everything the
  contract needs still gets re-validated server-side exactly as if it were
  untrusted -- because from the server's point of view, it is.

  The on-chain deployer for a sponsored launch is the sponsor wallet, not the
  visitor. That is a real, visible difference from paying yourself, which is
  why "pay it yourself instead" stays one click away rather than this being
  the only option.

  The opening buy is never part of what Fons sponsors, even if the visitor
  set an amount back on the edit step. Fons's wallet only ever pays to create
  the token itself; a purchase is a separate, optional transaction that comes
  out of the visitor's own wallet, exactly the way it already works on the
  self-pay path. That is why this component has its own connect-and-buy step
  after the launch confirms, instead of quietly folding the amount into the
  sponsored call.
*/

type SponsoredLaunchReviewProps = {
  name: string;
  ticker: string;
  description: string;
  imageUri: string;
  avatarSrc: string;
  twitter: string;
  telegram: string;
  website: string;
  initialBuy: string;
  sponsorAddress: string;
  onBack: () => void;
  onSwitchToSelfPay: () => void;
};

export function SponsoredLaunchReview(props: SponsoredLaunchReviewProps) {
  const navigate = useNavigate();
  const { address, walletClient, publicClient, connect } = useChain();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [launched, setLaunched] = useState<{ token: string; curve: string } | null>(null);
  const [buying, setBuying] = useState(false);
  const [buyNote, setBuyNote] = useState("");

  const buyWei = ethToWei(props.initialBuy);
  const wantsBuy = buyWei > 0n;

  async function onLaunch() {
    if (submitting) return;
    setSubmitting(true);
    setError("");
    track("sponsored_launch_started");
    const result = await submitSponsoredLaunch({
      name: props.name,
      ticker: props.ticker,
      description: props.description,
      logo: props.imageUri || props.avatarSrc,
      socials: { twitter: props.twitter, telegram: props.telegram, website: props.website },
      creator_wallet: props.sponsorAddress,
      creator_tax_bps: 0,
      buyback_enabled: false,
    });
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error.message || "The sponsored launch failed.");
      track("sponsored_launch_failed", { code: result.error.code });
      return;
    }
    const current = readPendingLaunch();
    writePendingLaunch({
      token: result.data.token ?? null,
      curve: result.data.curve ?? null,
      creator: props.sponsorAddress,
      metadata_uri: current?.metadata_uri ?? "",
      image_uri: props.imageUri,
      image_hash: current?.image_hash ?? "",
      tx_hash: result.data.tx_hash,
      created_at: new Date().toISOString(),
      state: result.data.status === "confirmed" ? "confirmed" : "submitted",
      name: props.name,
      ticker: props.ticker,
      generated: current?.generated ?? false,
    });
    track("sponsored_launch_confirmed");
    if (!result.data.token || !result.data.curve) {
      // Sent but not yet confirmed within the request's time budget. The
      // tx hash is enough to look it up rather than leaving the visitor
      // staring at a spinner, and there is no curve address yet to buy against.
      setError(`Sent. Waiting for confirmation — ${result.data.explorer_url}`);
      return;
    }
    if (!wantsBuy) {
      navigate(`/app/launch/success?token=${result.data.token}`);
      return;
    }
    setLaunched({ token: result.data.token, curve: result.data.curve });
  }

  async function onBuy() {
    if (!launched || buying) return;
    if (!address || !walletClient) {
      track("wallet_connect_requested");
      await connect();
      return;
    }
    setBuying(true);
    setBuyNote("");
    try {
      await submitInitialBuy(walletClient, publicClient, address, launched.curve as Address, buyWei);
      track("initial_buy_submitted");
    } catch (err: unknown) {
      track("initial_buy_skipped");
      setBuyNote(err instanceof Error ? err.message : "The opening buy did not go through. Your token still exists.");
    } finally {
      setBuying(false);
      navigate(`/app/launch/success?token=${launched.token}`);
    }
  }

  function onSkipBuy() {
    if (!launched) return;
    track("initial_buy_skipped");
    navigate(`/app/launch/success?token=${launched.token}`);
  }

  if (launched) {
    return (
      <section className="page launch-review">
        <header className="page-head">
          <div className="stack sm">
            <p className="eyebrow">Token created</p>
            <AnimatedText as="h1" reveal="lines" lines={["Buy from your own wallet, or skip it"]} />
          </div>
          <GlassMark state="wallet" quiet className="sz-sm" />
        </header>

        <div className="panel stack">
          <p className="eyebrow">Opening buy</p>
          <dl className="facts strong">
            <div>
              <dt>Amount</dt>
              <dd>{formatEth(props.initialBuy)}</dd>
            </div>
            <div>
              <dt>Paid from</dt>
              <dd>Your wallet, not Fons's</dd>
            </div>
          </dl>
          <p className="metric-label">
            Fons only paid to create {props.ticker}. This purchase is optional, is its own signature, and comes out
            of your own wallet if you go ahead with it.
          </p>
          {buyNote ? <p className="note warn">{buyNote}</p> : null}
        </div>

        <div className="review-actions">
          <Button type="button" variant="ghost" onClick={onSkipBuy} disabled={buying}>
            Skip, go to token
          </Button>
          <Button
            type="button"
            variant="primary"
            size="lg"
            aria-busy={buying || undefined}
            onClick={() => void onBuy()}
            disabled={buying}
          >
            {buying ? "Buying…" : address ? `Buy ${formatEth(props.initialBuy)}` : "Connect wallet to buy"}
          </Button>
        </div>
      </section>
    );
  }

  return (
    <section className="page launch-review">
      <header className="page-head">
        <div className="stack sm">
          <p className="eyebrow">Sponsored launch</p>
          <AnimatedText as="h1" reveal="lines" lines={["Fons pays. Nothing to sign."]} />
        </div>
        <GlassMark state={submitting ? "generating" : "wallet"} quiet className="sz-sm" />
      </header>

      <div className="review-grid">
        <div className="panel stack">
          <p className="eyebrow">Token</p>
          <div className="review-token">
            {props.avatarSrc ? <img className="avatar" src={props.avatarSrc} alt="" width={96} height={96} /> : null}
            <div className="stack sm">
              <strong className="review-token-name">
                {props.name} <span className="metric-label">${props.ticker}</span>
              </strong>
            </div>
          </div>
        </div>

        <div className="panel stack">
          <p className="eyebrow">Cost</p>
          <dl className="facts strong">
            <div>
              <dt>Launch fee</dt>
              <dd>Covered by Fons</dd>
            </div>
            <div>
              <dt>Gas</dt>
              <dd>Covered by Fons</dd>
            </div>
            <div>
              <dt>You pay</dt>
              <dd>0 ETH</dd>
            </div>
          </dl>
          <p className="metric-label">
            No wallet connection needed for this launch. The transaction is still simulated against the chain
            before anything is sent.
          </p>
          {wantsBuy ? (
            <p className="metric-label">
              You set an opening buy of {formatEth(props.initialBuy)}. Fons does not pay for that part — you will be
              asked to connect your own wallet for it, as its own step, right after the token exists.
            </p>
          ) : null}
        </div>
      </div>

      <div className="stack sm">
        {error ? <p className="note error">{error}</p> : null}
        {submitting ? <p className="metric-label">Building, simulating and sending the launch transaction</p> : null}
      </div>

      <div className="review-actions">
        <Button type="button" variant="ghost" onClick={props.onBack} disabled={submitting}>
          Back to edit
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={props.onSwitchToSelfPay} disabled={submitting}>
          Pay it yourself instead
        </Button>
        <Button
          type="button"
          variant="primary"
          size="lg"
          aria-busy={submitting || undefined}
          onClick={() => void onLaunch()}
          disabled={submitting}
        >
          {submitting ? "Launching…" : "Launch for free"}
        </Button>
      </div>
    </section>
  );
}
