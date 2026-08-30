import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import type { VersionedTransaction } from "@solana/web3.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { appConfig, clusterLabel } from "../../app/config";
import { formatSol } from "../../domain/validation";
import { readPendingLaunch, writePendingLaunch } from "../../domain/pendingLaunch";
import { fetchLaunchHealth, type NameCheckResult } from "../../services/api";
import {
  expectedProgramsNote,
  getTransactionBoundary,
  NAME_CHECK_NOTICE,
  NAME_CHECK_UNAVAILABLE,
  type LaunchState,
} from "../../services/pumpBoundary";
import { solToLamports } from "../../solana/lamports";
import { mintKeypairForUri, wipeMintSecret } from "../../solana/mintMemory";
import {
  acquireLaunchSubmit,
  buildLaunchInstructions,
  compileLaunchTransaction,
  confirmLaunch,
  fetchLaunchGlobal,
  formatCost,
  LaunchError,
  reconcileLaunch,
  releaseLaunchSubmit,
  signLaunchTransaction,
  simulateAndEstimate,
  submitLaunchTransaction,
  verifyOnchainLaunch,
  type CostEstimate,
  type PreparedLaunchTx,
} from "../../solana/pumpLaunch";
import { Button } from "../ui/Button";
import { BornMascot } from "../brand/BornMascot";
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
        <dt>Pump creation fee</dt>
        <dd>{formatted.pumpCreation}</dd>
      </div>
      <div>
        <dt>MIXBORN fee</dt>
        <dd>{formatted.mixbornFee}</dd>
      </div>
      <div>
        <dt>Network + rent</dt>
        <dd>{estimate ? formatted.networkRent : unknown}</dd>
      </div>
      <div>
        <dt>Initial buy</dt>
        <dd>{formatSol(initialBuy)}</dd>
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
      <p>{props.description.trim() || "Description appears here."}</p>
      <p className="preview-socials">
        {props.twitter ? <span>X</span> : null}
        {props.telegram ? <span>Telegram</span> : null}
        {props.website ? <span>Web</span> : null}
      </p>
      {props.generated ? <p className="metric-label">Generated with MIXBORN</p> : null}
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
  const { connection } = useConnection();
  const wallet = useWallet();
  const { setVisible } = useWalletModal();
  const [phase, setPhase] = useState<LaunchState>("REVIEWING");
  const [estimate, setEstimate] = useState<CostEstimate | null>(null);
  const [error, setError] = useState("");
  const [healthCluster, setHealthCluster] = useState<string | null>(null);
  const [createV2Disabled, setCreateV2Disabled] = useState(false);
  const [allowlistOk, setAllowlistOk] = useState<boolean | undefined>(undefined);
  const [simulationOk, setSimulationOk] = useState<boolean | undefined>(undefined);
  const [rebuildOffer, setRebuildOffer] = useState<"same-mint" | "new-mint" | null>(null);
  const preparedRef = useRef<PreparedLaunchTx | null>(null);
  const sentRef = useRef(false);

  const clusterMismatch = Boolean(healthCluster && healthCluster !== appConfig.cluster);
  const boundary = getTransactionBoundary({
    walletConnected: wallet.connected,
    walletConnecting: wallet.connecting,
    simulationOk,
    allowlistOk,
    clusterMismatch,
    createV2Disabled,
    metadataUri: props.metadataUri,
  });

  const persist = useCallback(
    (patch: Partial<{ mint: string | null; creator: string | null; signature: string | null; state: "prepared" | "submitted" | "confirmed" | "failed" | "unknown" }>) => {
      const current = readPendingLaunch();
      if (!current) return;
      writePendingLaunch({ ...current, ...patch });
    },
    [],
  );

  const prepare = useCallback(async () => {
    if (!appConfig.enableNativeLaunch) return;
    if (appConfig.cluster === "mainnet-beta" && !appConfig.enableMainnetLaunch) return;
    if (!wallet.connected || !wallet.publicKey) return;
    if (clusterMismatch || createV2Disabled) return;
    setPhase("GENERATING_MINT");
    setError("");
    setRebuildOffer(null);
    try {
      const mint = mintKeypairForUri(props.metadataUri);
      persist({ mint: mint.publicKey.toBase58(), creator: wallet.publicKey.toBase58(), state: "prepared" });
      setPhase("BUILDING_TRANSACTION");
      const global = await fetchLaunchGlobal(connection);
      const lamports = solToLamports(props.initialBuy);
      const instructions = await buildLaunchInstructions({
        mint: mint.publicKey,
        name: props.name,
        symbol: props.ticker,
        uri: props.metadataUri,
        user: wallet.publicKey,
        initialBuyLamports: lamports,
        global,
      });
      const compiled = await compileLaunchTransaction({
        connection,
        instructions,
        payer: wallet.publicKey,
        mint,
        uri: props.metadataUri,
        initialBuyLamports: lamports,
      });
      setAllowlistOk(true);
      setPhase("SIMULATING");
      const simulated = await simulateAndEstimate(connection, compiled, wallet.publicKey);
      preparedRef.current = simulated;
      setEstimate(simulated.estimate);
      setSimulationOk(true);
      setPhase("READY_TO_SIGN");
      track("launch_simulation_succeeded");
    } catch (err: unknown) {
      preparedRef.current = null;
      setEstimate(null);
      setSimulationOk(false);
      if (err instanceof LaunchError && err.code === "UNEXPECTED_PROGRAM") {
        setAllowlistOk(false);
      }
      if (err instanceof LaunchError && err.code === "CREATE_V2_DISABLED") {
        setCreateV2Disabled(true);
      }
      if (err instanceof LaunchError && err.code === "SIMULATION_FAILED") {
        setSimulationOk(false);
      }
      setPhase("RECOVERABLE_FAILURE");
      setError(err instanceof LaunchError ? err.message : err instanceof Error ? err.message : "Launch preparation failed.");
      track("launch_simulation_failed");
    }
  }, [
    clusterMismatch,
    connection,
    createV2Disabled,
    persist,
    props.initialBuy,
    props.metadataUri,
    props.name,
    props.ticker,
    wallet.connected,
    wallet.publicKey,
  ]);

  useEffect(() => {
    const controller = new AbortController();
    fetchLaunchHealth(controller.signal).then((health) => {
      if (health?.cluster) setHealthCluster(health.cluster);
    });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    void prepare();
  }, [prepare]);

  async function onSign() {
    if (!boundary.signEnabled || !wallet.publicKey) return;
    if (!acquireLaunchSubmit()) return;
    sentRef.current = false;
    const prepared = preparedRef.current;
    const pending = readPendingLaunch();
    if (pending?.state === "submitted" && pending.signature) {
      setPhase("RECONCILING");
      setError("A launch transaction was already submitted. Reconcile before sending again.");
      releaseLaunchSubmit();
      return;
    }
    if (!prepared || !wallet.signTransaction) {
      setError("Connect a wallet that can sign versioned transactions.");
      releaseLaunchSubmit();
      return;
    }
    setPhase("WALLET_OPEN");
    setError("");
    try {
      const signed = await signLaunchTransaction(
        {
          publicKey: wallet.publicKey,
          signTransaction: (tx) => wallet.signTransaction!(tx) as Promise<VersionedTransaction>,
        },
        prepared,
      );
      setPhase("SUBMITTING");
      persist({ mint: prepared.mint.toBase58(), creator: wallet.publicKey.toBase58(), state: "submitted" });
      const signature = await submitLaunchTransaction(connection, signed);
      sentRef.current = true;
      persist({ signature, state: "submitted" });
      track("launch_submitted");
      setPhase("CONFIRMING");
      setError("Transaction sent. Waiting for confirmation.");
      const confirmed = await confirmLaunch({
        connection,
        signature,
        blockhash: prepared.blockhash,
        lastValidBlockHeight: prepared.lastValidBlockHeight,
        mint: prepared.mint,
        user: wallet.publicKey,
        uri: props.metadataUri,
      });
      persist({ signature: confirmed.signature, mint: confirmed.mint, state: "confirmed" });
      wipeMintSecret();
      setPhase("SUCCESS");
      track("launch_confirmed", { generated: props.generated });
      navigate(`/app/launch/success?mint=${confirmed.mint}`);
    } catch (err: unknown) {
      const code = err instanceof LaunchError ? err.code : "";
      if (code === "WALLET_REJECTED") {
        setPhase("READY_TO_SIGN");
        setError("Wallet signature was rejected. Nothing was sent.");
        track("wallet_signature_rejected");
      } else if (code === "TRANSACTION_EXPIRED") {
        setPhase("RECOVERABLE_FAILURE");
        setRebuildOffer("same-mint");
        setError("The blockhash expired. Rebuild the same mint transaction.");
      } else if (code === "TRANSACTION_UNKNOWN") {
        setPhase("RECONCILING");
        setRebuildOffer("new-mint");
        setError("Send result is unknown. Reconcile before building a new mint.");
        track("launch_reconciliation_needed");
      } else if (code === "INSUFFICIENT_BALANCE") {
        setPhase("READY_TO_SIGN");
        setError("This wallet does not have enough SOL for the review total.");
        setSimulationOk(false);
      } else if (code === "LAUNCH_NOT_CONFIRMED") {
        setPhase("RECONCILING");
        setError(err instanceof Error ? err.message : "Launch is not confirmed.");
        track("launch_reconciliation_needed");
      } else {
        setPhase("RECOVERABLE_FAILURE");
        setError(err instanceof Error ? err.message : "Launch failed.");
      }
    } finally {
      releaseLaunchSubmit();
    }
  }

  async function onReconcile() {
    const pending = readPendingLaunch();
    if (!pending?.mint || !wallet.publicKey) {
      setError("Nothing to reconcile yet.");
      return;
    }
    setPhase("RECONCILING");
    try {
      const { PublicKey } = await import("@solana/web3.js");
      const mint = new PublicKey(pending.mint);
      let signatureStatus: "confirmed" | "finalized" | "failed" | "pending" | "unknown" | null = null;
      if (pending.signature) {
        const statuses = await connection.getSignatureStatuses([pending.signature]);
        const status = statuses.value[0];
        if (!status) signatureStatus = "unknown";
        else if (status.err) signatureStatus = "failed";
        else if (status.confirmationStatus === "finalized") signatureStatus = "finalized";
        else if (status.confirmationStatus === "confirmed") signatureStatus = "confirmed";
        else signatureStatus = "pending";
      }
      const verified = await verifyOnchainLaunch(connection, mint, wallet.publicKey, props.metadataUri);
      const decision = reconcileLaunch({
        signature: pending.signature,
        signatureStatus,
        mintExists: verified.ok || Boolean((await connection.getAccountInfo(mint, "confirmed"))),
        bondingCurveOk: verified.ok,
        creatorMatches: verified.ok,
        uriMatches: verified.ok,
        blockhashExpired: !pending.signature,
      });
      if (decision === "confirmed" && verified.ok) {
        persist({ state: "confirmed" });
        wipeMintSecret();
        track("launch_confirmed", { generated: props.generated });
        navigate(`/app/launch/success?mint=${mint.toBase58()}`);
        return;
      }
      if (decision === "wait") {
        setError("Transaction is still unknown. Wait, then reconcile again. A new mint is not created automatically.");
        track("launch_reconciliation_needed");
        return;
      }
      if (decision === "rebuild") {
        setRebuildOffer(pending.signature ? "new-mint" : "same-mint");
        setError("Transaction did not land. Rebuild requires an explicit confirm.");
        return;
      }
      setRebuildOffer("new-mint");
      setError("Launch is not confirmed. Do not assume success.");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Reconciliation failed.");
    }
  }

  function onRebuildSameMint() {
    setSimulationOk(undefined);
    setAllowlistOk(undefined);
    void prepare();
  }

  function onRebuildNewMint() {
    const ok = window.confirm("Build a new launch transaction with a new mint? The previous mint secret will be destroyed.");
    if (!ok) return;
    wipeMintSecret();
    persist({ mint: null, signature: null, state: "prepared" });
    setSimulationOk(undefined);
    setAllowlistOk(undefined);
    void prepare();
  }

  const check = props.nameCheck;
  const notice = !check || !check.check_available ? NAME_CHECK_UNAVAILABLE : check.notice || NAME_CHECK_NOTICE;
  const matches = check?.check_available
    ? `Exact name matches: ${check.name_matches}. Exact ticker matches: ${check.ticker_matches}.`
    : NAME_CHECK_UNAVAILABLE;
  const signDisabled = !boundary.signEnabled || phase === "SUBMITTING" || phase === "WALLET_OPEN" || phase === "CONFIRMING";

  return (
    <section className="page launch-review">
      <header className="page-head">
        <div className="stack sm">
          <p className="eyebrow">Review launch</p>
          <h1>
            {boundary.signEnabled
              ? "Review the debit, then approve in your wallet."
              : "Nothing is signed until the Pump path is ready."}
          </h1>
        </div>
        <BornMascot
          variant="portrait"
          state={phase === "WALLET_OPEN" ? "wallet" : error ? "warning" : "idle"}
          quiet
          className="bare sz-sm"
        />
      </header>

      <SafetyBanner showFee />

      <div className="review-grid">
        <div className="panel stack">
          <p className="eyebrow">Token</p>
          <div className="review-token">
            {props.avatarSrc ? (
              <img className="avatar" src={props.avatarSrc} alt="" width={96} height={96} />
            ) : null}
            <div className="stack sm">
              <strong className="review-token-name">
                {props.name} <span className="metric-label">${props.ticker}</span>
              </strong>
              {props.generated ? <span className="chip copper">Generated with MIXBORN</span> : null}
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
          <p className="metric-label">
            Slippage 1% conservative default. Applied at sign time. Costs come from simulation, not marketing constants.
          </p>
        </div>

        <div className="panel stack">
          <p className="eyebrow">Market name check</p>
          <p className="body-copy">{matches}</p>
          <p className="metric-label">{notice}</p>
        </div>

        <div className="panel stack">
          <p className="eyebrow">Network</p>
          <p className="body-copy">{clusterLabel(appConfig.cluster)}</p>
          {clusterMismatch ? (
            <p className="note error">RPC cluster does not match the UI network badge.</p>
          ) : null}
        </div>

        <div className="panel stack">
          <p className="eyebrow">Mechanics</p>
          <p className="body-copy">Pump bonding curve → automatic PumpSwap migration</p>
          <p className="metric-label">Mayhem off. Cashback off. SOL quote. MIXBORN launch fee 0.</p>
        </div>

        <div className="panel stack">
          <p className="eyebrow">Authorities / programs</p>
          <p className="metric-label">{expectedProgramsNote()}</p>
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
        {phase === "WALLET_OPEN" ? <p className="metric-label">Approve the transaction in your wallet.</p> : null}
        {phase === "SUBMITTING" || phase === "CONFIRMING" ? (
          <p className="metric-label">Transaction sent. Waiting for on-chain confirmation.</p>
        ) : null}
        {phase === "RECONCILING" ? (
          <div className="btn-row">
            <Button type="button" variant="secondary" onClick={() => void onReconcile()}>
              Reconcile launch
            </Button>
          </div>
        ) : null}
        {rebuildOffer === "same-mint" ? (
          <div className="btn-row">
            <Button type="button" variant="secondary" onClick={onRebuildSameMint}>
              Rebuild same mint transaction
            </Button>
          </div>
        ) : null}
        {rebuildOffer === "new-mint" ? (
          <div className="btn-row">
            <Button type="button" variant="ghost" onClick={onRebuildNewMint}>
              Build new launch transaction
            </Button>
          </div>
        ) : null}
      </div>

      <div className="review-actions">
        <Button type="button" variant="ghost" onClick={props.onBack}>
          Back to edit
        </Button>
        {!wallet.connected ? (
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              track("wallet_connect_requested");
              setVisible(true);
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
        Success requires on-chain confirmation. Duplicate clicks are ignored while a send is in flight.
      </p>
    </section>
  );
}
