import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Address } from "viem";
import { appConfig, networkLabel } from "../../app/config";
import { formatEth } from "../../domain/validation";
import { readPendingLaunch, writePendingLaunch } from "../../domain/pendingLaunch";
import { fetchLaunchHealth, type NameCheckResult } from "../../services/api";
import {
  expectedContractNote,
  getTransactionBoundary,
  NAME_CHECK_NOTICE,
  NAME_CHECK_UNAVAILABLE,
  type LaunchState,
} from "../../services/launchBoundary";
import { useChain } from "../../chain/wallet";
import { ethToWei } from "../../chain/units";
import { LaunchError } from "../../chain/errors";
import {
  acquireLaunchSubmit,
  confirmLaunch,
  formatCost,
  launchpadAddress,
  reconcileLaunch,
  releaseLaunchSubmit,
  simulateLaunch,
  submitInitialBuy,
  submitLaunch,
  type CostEstimate,
  type PreparedLaunch,
} from "../../chain/launchpad";
import { Button } from "../ui/Button";
import { GlassMark } from "../brand/GlassMark";
import { SafetyBanner } from "../layout/SafetyBanner";
import { track } from "../../services/analytics";

export function CostSummary({
  initialBuy,
  estimate,
  fallback,
}: {
  initialBuy: string;
  estimate?: CostEstimate | null;
  fallback?: string;
}) {
  const boundary = getTransactionBoundary();
  const unknown = fallback || boundary.unknownCostLabel;
  const formatted = formatCost(estimate ?? null, unknown);
  return (
    <dl className="facts strong">
      <div>
        <dt>Launchpad fee</dt>
        <dd>{formatted.launchFee}</dd>
      </div>
      <div>
        <dt>FONS fee</dt>
        <dd>{formatted.fonsFee}</dd>
      </div>
      <div>
        <dt>Gas</dt>
        <dd>{estimate ? formatted.gas : unknown}</dd>
      </div>
      <div>
        <dt>Initial buy</dt>
        <dd>{formatEth(initialBuy)}</dd>
      </div>
      <div>
        <dt>Maximum wallet debit</dt>
        <dd>{estimate ? formatted.maxDebit : unknown}</dd>
      </div>
      {estimate?.bufferLabel ? <p className="facts-note">{estimate.bufferLabel}</p> : null}
    </dl>
  );
}

export function LivePreview(props: {
  name: string;
  ticker: string;
  description: string;
  avatarSrc: string;
  twitter: string;
  telegram: string;
  website: string;
  generated: boolean;
}) {
  return (
    <div className="live-preview">
      {props.avatarSrc ? (
        <img className="avatar" src={props.avatarSrc} alt="" width={256} height={256} />
      ) : (
        <div className="avatar placeholder" aria-hidden="true" />
      )}
      <h2>
        {props.name.trim() || "Untitled"} <span className="live-preview-ticker">${props.ticker || "TICKER"}</span>
      </h2>
      <p>{props.description.trim() || "Description appears here"}</p>
      <p className="preview-socials">
        {props.twitter ? <span>X</span> : null}
        {props.telegram ? <span>Telegram</span> : null}
        {props.website ? <span>Web</span> : null}
      </p>
      {props.generated ? <p className="metric-label">Generated with FONS</p> : null}
    </div>
  );
}

type LaunchReviewProps = {
  name: string;
  ticker: string;
  description: string;
  avatarSrc: string;
  imageHash: string;
  metadataUri: string;
  /** The pinned image, which Pons stores on the launch as its logo. */
  imageUri: string;
  twitter: string;
  telegram: string;
  website: string;
  initialBuy: string;
  generated: boolean;
  nameCheck: NameCheckResult | null;
  onBack: () => void;
};

export function LaunchReview(props: LaunchReviewProps) {
  const navigate = useNavigate();
  const { address, phase, onTargetChain, publicClient, walletClient, connect, switchNetwork } = useChain();
  const [state, setState] = useState<LaunchState>("REVIEWING");
  const [estimate, setEstimate] = useState<CostEstimate | null>(null);
  const [error, setError] = useState("");
  const [healthChainId, setHealthChainId] = useState<number | null>(null);
  const [contractOk, setContractOk] = useState<boolean | undefined>(undefined);
  const [simulationOk, setSimulationOk] = useState<boolean | undefined>(undefined);
  const [rebuildOffer, setRebuildOffer] = useState(false);
  const preparedRef = useRef<PreparedLaunch | null>(null);

  const chainMismatch = Boolean(healthChainId && healthChainId !== appConfig.chainId);
  const boundary = getTransactionBoundary({
    walletConnected: Boolean(address) && onTargetChain,
    walletConnecting: phase === "connecting",
    walletRejected: phase === "rejected",
    wrongNetwork: Boolean(address) && !onTargetChain,
    simulationOk,
    contractOk,
    metadataUri: props.metadataUri,
  });

  const persist = useCallback(
    (patch: Partial<{ token: string | null; curve: string | null; creator: string | null; tx_hash: string | null; state: "prepared" | "submitted" | "confirmed" | "failed" | "unknown" }>) => {
      const current = readPendingLaunch();
      if (!current) return;
      writePendingLaunch({ ...current, ...patch });
    },
    [],
  );

  const prepare = useCallback(async () => {
    if (!boundary.launchpadConfigured || !appConfig.enableNativeLaunch) return;
    if (appConfig.mainnet && !appConfig.enableMainnetLaunch) return;
    if (!address || !onTargetChain || chainMismatch) return;
    setState("BUILDING_TRANSACTION");
    setError("");
    setRebuildOffer(false);
    try {
      persist({ creator: address, state: "prepared" });
      setState("SIMULATING");
      const prepared = await simulateLaunch({
        client: publicClient,
        account: address,
        name: props.name,
        symbol: props.ticker,
        metadataUri: props.metadataUri,
        initialBuyWei: ethToWei(props.initialBuy),
        // Pons stores these on the launch itself, so they go in the call
        // rather than only into the pinned metadata document.
        description: props.description,
        logo: props.imageUri || props.avatarSrc,
        socials: {
          twitter: props.twitter,
          telegram: props.telegram,
          website: props.website,
        },
      });
      preparedRef.current = prepared;
      setEstimate(prepared.estimate);
      setContractOk(true);
      setSimulationOk(true);
      setState("READY_TO_SIGN");
      track("launch_simulation_succeeded");
    } catch (err: unknown) {
      preparedRef.current = null;
      setEstimate(null);
      const code = err instanceof LaunchError ? err.code : "";
      if (code === "LAUNCHPAD_NOT_DEPLOYED" || code === "LAUNCHPAD_NOT_CONFIGURED") setContractOk(false);
      setSimulationOk(false);
      setState("RECOVERABLE_FAILURE");
      setError(err instanceof Error ? err.message : "Launch preparation failed.");
      track("launch_simulation_failed");
    }
  }, [
    address,
    boundary.launchpadConfigured,
    chainMismatch,
    onTargetChain,
    persist,
    props.avatarSrc,
    props.description,
    props.imageUri,
    props.initialBuy,
    props.metadataUri,
    props.name,
    props.telegram,
    props.ticker,
    props.twitter,
    props.website,
    publicClient,
  ]);

  useEffect(() => {
    const controller = new AbortController();
    fetchLaunchHealth(controller.signal).then((health) => {
      if (health?.chain_id) setHealthChainId(Number(health.chain_id));
    });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    void prepare();
  }, [prepare]);

  async function onSign() {
    if (!boundary.signEnabled || !address || !walletClient) return;
    if (!acquireLaunchSubmit()) return;
    const prepared = preparedRef.current;
    const pending = readPendingLaunch();
    if (pending?.state === "submitted" && pending.tx_hash) {
      setState("RECONCILING");
      setError("A launch transaction was already submitted. Reconcile before sending again.");
      releaseLaunchSubmit();
      return;
    }
    if (!prepared) {
      setError("Rebuild the transaction before signing.");
      releaseLaunchSubmit();
      return;
    }
    setState("WALLET_OPEN");
    setError("");
    try {
      const hash = await submitLaunch(walletClient, address, prepared);
      persist({ creator: address, tx_hash: hash, state: "submitted" });
      track("launch_submitted");
      setState("CONFIRMING");
      setError("Transaction sent. Waiting for confirmation.");
      const confirmed = await confirmLaunch(publicClient, hash);
      persist({ token: confirmed.token, curve: confirmed.curve, tx_hash: confirmed.hash, state: "confirmed" });
      track("launch_confirmed", { generated: props.generated });

      /*
        The opening buy is deliberately after the launch is already confirmed
        and persisted. Pons requires msg.value on launchToken to equal the
        launch fee exactly, so it cannot be bundled; and the token exists
        either way, so a declined or failed buy must never read as a failed
        launch.
      */
      const buyWei = ethToWei(props.initialBuy);
      if (buyWei > 0n) {
        setState("SUBMITTING");
        setError("Token created. Approve the opening buy, or skip it.");
        try {
          await submitInitialBuy(walletClient, publicClient, address, confirmed.curve, buyWei);
          track("initial_buy_submitted");
        } catch (buyErr: unknown) {
          track("initial_buy_skipped");
          console.warn("Opening buy did not go through:", buyErr);
        }
      }

      setState("SUCCESS");
      navigate(`/app/launch/success?token=${confirmed.token}`);
    } catch (err: unknown) {
      const code = err instanceof LaunchError ? err.code : "";
      if (code === "WALLET_REJECTED") {
        setState("READY_TO_SIGN");
        setError("Wallet signature was rejected. Nothing was sent.");
        track("wallet_signature_rejected");
      } else if (code === "INSUFFICIENT_BALANCE") {
        setState("READY_TO_SIGN");
        setError("This wallet does not have enough ETH for the review total.");
        setSimulationOk(false);
      } else if (code === "TRANSACTION_UNKNOWN" || code === "TRANSACTION_REPLACED") {
        setState("RECONCILING");
        setError("Send result is unknown. Reconcile before building a new token.");
        track("launch_reconciliation_needed");
      } else if (code === "LAUNCH_REVERTED" || code === "LAUNCH_NOT_CONFIRMED") {
        setState("RECONCILING");
        setError(err instanceof Error ? err.message : "Launch is not confirmed.");
        track("launch_reconciliation_needed");
      } else {
        setState("RECOVERABLE_FAILURE");
        setError(err instanceof Error ? err.message : "Launch failed.");
      }
    } finally {
      releaseLaunchSubmit();
    }
  }

  async function onReconcile() {
    const pending = readPendingLaunch();
    if (!pending?.tx_hash) {
      setError("Nothing to reconcile yet.");
      return;
    }
    setState("RECONCILING");
    try {
      let receiptStatus: "success" | "reverted" | "pending" | "unknown" | null = null;
      let token: string | null = pending.token;
      try {
        const receipt = await publicClient.getTransactionReceipt({ hash: pending.tx_hash as `0x${string}` });
        receiptStatus = receipt.status === "success" ? "success" : "reverted";
        // TokenLaunched puts the token in topic 1 and the curve in topic 2.
        const created = receipt.logs.find(
          (log) => log.address.toLowerCase() === launchpadAddress()?.toLowerCase() && log.topics.length >= 3,
        );
        if (created?.topics?.[1]) token = `0x${created.topics[1].slice(-40)}`;
      } catch {
        receiptStatus = "pending";
      }
      const tokenExists = Boolean(
        token && (await publicClient.getCode({ address: token as Address })) !== "0x",
      );
      const decision = reconcileLaunch({ hash: pending.tx_hash, receiptStatus, tokenExists });
      if (decision === "confirmed" && token) {
        persist({ token, state: "confirmed" });
        track("launch_confirmed", { generated: props.generated });
        navigate(`/app/launch/success?token=${token}`);
        return;
      }
      if (decision === "wait") {
        setError("The transaction is still pending. Wait, then reconcile again. A new token is not created automatically.");
        track("launch_reconciliation_needed");
        return;
      }
      setRebuildOffer(true);
      setError("The transaction did not land. Rebuilding requires an explicit confirm.");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Reconciliation failed.");
    }
  }

  function onRebuild() {
    const ok = window.confirm("Build a new launch transaction? Only do this once you are sure the previous one did not land.");
    if (!ok) return;
    persist({ token: null, tx_hash: null, state: "prepared" });
    setSimulationOk(undefined);
    setContractOk(undefined);
    void prepare();
  }

  const check = props.nameCheck;
  const notice = !check || !check.check_available ? NAME_CHECK_UNAVAILABLE : check.notice || NAME_CHECK_NOTICE;
  const matches = check?.check_available
    ? `Exact name matches: ${check.name_matches}. Exact ticker matches: ${check.ticker_matches}.`
    : NAME_CHECK_UNAVAILABLE;
  const signDisabled =
    !boundary.signEnabled || state === "SUBMITTING" || state === "WALLET_OPEN" || state === "CONFIRMING";

  return (
    <section className="page launch-review">
      <header className="page-head">
        <div className="stack sm">
          <p className="eyebrow">Review launch</p>
          <h1>
            {boundary.signEnabled
              ? "Review the debit, then approve in MetaMask"
              : "Nothing is signed until the launchpad is connected"}
          </h1>
        </div>
        <GlassMark
          state={state === "WALLET_OPEN" ? "wallet" : error ? "warning" : "idle"}
          quiet
          className="sz-sm"
        />
      </header>

      <SafetyBanner showFee />

      <div className="review-grid">
        <div className="panel stack">
          <p className="eyebrow">Token</p>
          <div className="review-token">
            {props.avatarSrc ? <img className="avatar" src={props.avatarSrc} alt="" width={96} height={96} /> : null}
            <div className="stack sm">
              <strong className="review-token-name">
                {props.name} <span className="metric-label">${props.ticker}</span>
              </strong>
              {props.generated ? <span className="chip sun">Generated with FONS</span> : null}
            </div>
          </div>
          <dl className="facts">
            <div>
              <dt>Avatar hash</dt>
              <dd>{props.imageHash}</dd>
            </div>
            <div>
              <dt>Metadata URI</dt>
              <dd>{props.metadataUri}</dd>
            </div>
          </dl>
        </div>

        <div className="panel stack">
          <p className="eyebrow">Cost</p>
          <CostSummary initialBuy={props.initialBuy} estimate={estimate} />
          <p className="metric-label">Gas comes from the node estimate, not a marketing constant</p>
        </div>

        <div className="panel stack">
          <p className="eyebrow">Market name check</p>
          <p className="body-copy">{matches}</p>
          <p className="metric-label">{notice}</p>
        </div>

        <div className="panel stack">
          <p className="eyebrow">Network</p>
          <p className="body-copy">{networkLabel()}</p>
          {chainMismatch ? <p className="note error">The API is on a different chain than this build expects</p> : null}
          {address && !onTargetChain ? (
            <div className="btn-row">
              <Button type="button" variant="secondary" size="sm" onClick={() => void switchNetwork()}>
                Switch to Robinhood Chain
              </Button>
            </div>
          ) : null}
        </div>

        <div className="panel stack">
          <p className="eyebrow">Mechanics</p>
          <p className="body-copy">Fons launchpad on Robinhood Chain, then trading wherever the token is listed</p>
          <p className="metric-label">Gas in ETH. FONS launch fee 0</p>
        </div>

        <div className="panel stack">
          <p className="eyebrow">Contract</p>
          <p className="metric-label">{expectedContractNote()}</p>
          <p className="metric-label">{launchpadAddress() ?? "Not configured"}</p>
        </div>

        {props.twitter || props.telegram || props.website ? (
          <div className="panel stack">
            <p className="eyebrow">Links</p>
            {props.twitter ? <p className="metric-label">X {props.twitter}</p> : null}
            {props.telegram ? <p className="metric-label">Telegram {props.telegram}</p> : null}
            {props.website ? <p className="metric-label">Website {props.website}</p> : null}
          </div>
        ) : null}
      </div>

      <div className="stack sm">
        <p className={boundary.signEnabled ? "metric-label" : "note warn"}>{boundary.reason}</p>
        {error ? <p className="note error">{error}</p> : null}
        {state === "WALLET_OPEN" ? <p className="metric-label">Approve the transaction in MetaMask</p> : null}
        {state === "CONFIRMING" ? <p className="metric-label">Transaction sent. Waiting for on-chain confirmation</p> : null}
        {state === "RECONCILING" ? (
          <div className="btn-row">
            <Button type="button" variant="secondary" onClick={() => void onReconcile()}>
              Reconcile launch
            </Button>
          </div>
        ) : null}
        {rebuildOffer ? (
          <div className="btn-row">
            <Button type="button" variant="ghost" onClick={onRebuild}>
              Build a new launch transaction
            </Button>
          </div>
        ) : null}
      </div>

      <div className="review-actions">
        <Button type="button" variant="ghost" onClick={props.onBack}>
          Back to edit
        </Button>
        {!address ? (
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              track("wallet_connect_requested");
              void connect();
            }}
          >
            Connect wallet
          </Button>
        ) : null}
        <Button
          type="button"
          variant="primary"
          size="lg"
          disabled={signDisabled}
          title={signDisabled ? boundary.reason : "Sign and launch"}
          aria-disabled={signDisabled}
          onClick={() => void onSign()}
        >
          Sign &amp; launch
        </Button>
      </div>
      <p className="metric-label">
        Success requires an on-chain receipt. Duplicate clicks are ignored while a send is in flight
      </p>
    </section>
  );
}
