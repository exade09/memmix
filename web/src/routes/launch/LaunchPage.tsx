import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { appConfig } from "../../app/config";
import { AvatarCropper } from "../../components/launch/AvatarCropper";
import { CostSummary, LaunchReview, LivePreview } from "../../components/launch/LaunchReview";
import { Button, FileButton } from "../../components/ui/Button";
import { getMemoryAvatar, hasMemoryAvatar, setMemoryAvatar } from "../../domain/avatarMemory";
import { readDraftMix, readDraftToken, writeDraftToken } from "../../domain/draft";
import { DEVNET_LAUNCH_NOTICE } from "../../domain/legalCopy";
import { isPublicImageUrl, missingAvatarAfterReload } from "../../domain/handoff";
import {
  clearPendingLaunch,
  readPendingLaunch,
  writePendingLaunch,
  type PendingLaunch,
} from "../../domain/pendingLaunch";
import {
  DESCRIPTION_MAX,
  INITIAL_BUY_DEFAULT,
  INITIAL_BUY_PRESETS,
  initialBuyError,
  isValidDescription,
  isValidName,
  NAME_MAX,
  normalizeInitialBuy,
  normalizeTicker,
  telegramError,
  twitterError,
  websiteError,
} from "../../domain/validation";
import {
  checkLaunchName,
  LaunchApiError,
  pinMetadata,
  type MetadataPinResult,
  type NameCheckResult,
} from "../../services/api";
import { getTransactionBoundary, type LaunchState } from "../../services/launchBoundary";
import { track } from "../../services/analytics";

export function LaunchPage() {
  const [params] = useSearchParams();
  const fromMix = params.get("source") === "mix";
  const [storedDraft] = useState(() => readDraftToken());
  const restored = fromMix ? storedDraft : storedDraft?.source === "direct" ? storedDraft : null;
  const memory = getMemoryAvatar();
  const [phase, setPhase] = useState<LaunchState>("EDITING");
  const [name, setName] = useState(restored?.name ?? "");
  const [ticker, setTicker] = useState(restored?.ticker ?? "");
  const [description, setDescription] = useState(restored?.description ?? "");
  const [twitter, setTwitter] = useState(restored?.twitter ?? "");
  const [telegram, setTelegram] = useState(restored?.telegram ?? "");
  const [website, setWebsite] = useState(restored?.website ?? "");
  const [initialBuy, setInitialBuy] = useState(normalizeInitialBuy(restored?.initial_buy_sol || INITIAL_BUY_DEFAULT));
  const [rights, setRights] = useState(false);
  const [risk, setRisk] = useState(false);
  const [socialsOpen, setSocialsOpen] = useState(Boolean(restored?.twitter || restored?.telegram || restored?.website));
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [avatarSrc, setAvatarSrc] = useState(memory.url || restored?.avatar_url || "");
  const [lostAvatar, setLostAvatar] = useState(
    fromMix && missingAvatarAfterReload(storedDraft?.avatar_url, hasMemoryAvatar()),
  );
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<PendingLaunch | null>(() => readPendingLaunch());
  const [pinResult, setPinResult] = useState<MetadataPinResult | null>(null);
  const [nameCheck, setNameCheck] = useState<NameCheckResult | null>(null);
  const boundary = getTransactionBoundary();

  useEffect(() => {
    if (!fromMix) return;
    const stored = readDraftToken();
    if (!stored) {
      setLostAvatar(true);
      return;
    }
    setName(stored.name);
    setTicker(stored.ticker);
    setDescription(stored.description);
    setTwitter(stored.twitter || "");
    setTelegram(stored.telegram || "");
    setWebsite(stored.website || "");
    setInitialBuy(normalizeInitialBuy(stored.initial_buy_sol || INITIAL_BUY_DEFAULT));
    setSocialsOpen(Boolean(stored.twitter || stored.telegram || stored.website));
    const mem = getMemoryAvatar();
    if (mem.url) setAvatarSrc(mem.url);
    else if (isPublicImageUrl(stored.avatar_url)) setAvatarSrc(stored.avatar_url || "");
    setLostAvatar(missingAvatarAfterReload(stored.avatar_url, hasMemoryAvatar()));
  }, [fromMix]);

  const tickerValue = normalizeTicker(ticker);
  const buyError = initialBuyError(initialBuy, appConfig.initialBuyMaxEth);
  const socialError = twitterError(twitter) || telegramError(telegram) || websiteError(website);
  const generated = Boolean(fromMix && restored?.generated);
  useEffect(() => {
    if (!fromMix) track("direct_launch_started");
  }, [fromMix]);
  const canReview =
    isValidName(name) &&
    tickerValue.length >= 1 &&
    tickerValue.length <= 6 &&
    isValidDescription(description) &&
    Boolean(avatarSrc) &&
    !lostAvatar &&
    rights &&
    risk &&
    !socialError &&
    !buyError;

  useEffect(() => {
    writeDraftToken({
      source: fromMix ? "ai_mix" : "direct",
      name,
      ticker: tickerValue,
      description,
      twitter,
      telegram,
      website,
      initial_buy_sol: normalizeInitialBuy(initialBuy),
      avatar_url: isPublicImageUrl(avatarSrc) ? avatarSrc : undefined,
      parent_a_mint: restored?.parent_a_mint,
      parent_b_mint: restored?.parent_b_mint,
      mix_strategy: restored?.mix_strategy,
      generated,
    });
  }, [
    fromMix,
    name,
    tickerValue,
    description,
    twitter,
    telegram,
    website,
    initialBuy,
    avatarSrc,
    generated,
    restored?.parent_a_mint,
    restored?.parent_b_mint,
    restored?.mix_strategy,
  ]);

  useEffect(() => {
    if (!isValidName(name) || tickerValue.length < 1) {
      setNameCheck(null);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      checkLaunchName(name.trim(), tickerValue, controller.signal)
        .then(setNameCheck)
        .catch((err: unknown) => {
          if (err instanceof DOMException && err.name === "AbortError") return;
          setNameCheck({
            check_available: false,
            name_matches: 0,
            ticker_matches: 0,
            notice: "Check unavailable",
          });
        });
    }, 400);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [name, tickerValue]);

  function onPickAvatar(file: File) {
    if (file.type === "image/svg+xml" || file.name.toLowerCase().endsWith(".svg")) {
      setError("SVG images are not accepted.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError("Image is too large. Maximum is 5 MB.");
      return;
    }
    setError("");
    setCropFile(file);
  }

  async function resolveAvatarBlob(): Promise<Blob | null> {
    const mem = getMemoryAvatar();
    if (mem.blob) return mem.blob;
    if (!isPublicImageUrl(avatarSrc)) return null;
    try {
      const response = await fetch(avatarSrc);
      if (!response.ok) return null;
      return await response.blob();
    } catch {
      return null;
    }
  }

  async function onReview() {
    if (!canReview) return;
    setPhase("PINNING_METADATA");
    setError("");
    try {
      const blob = await resolveAvatarBlob();
      if (!blob) {
        setLostAvatar(true);
        throw new Error("Upload an avatar to pin metadata. Reload cleared the unpinned image.");
      }
      const form = new FormData();
      form.append("avatar", blob, "avatar.png");
      form.append("name", name.trim());
      form.append("ticker", tickerValue);
      form.append("description", description.trim());
      form.append("twitter", twitter.trim());
      form.append("telegram", telegram.trim());
      form.append("website", website.trim());
      form.append("initial_buy_sol", normalizeInitialBuy(initialBuy));
      form.append("generated", generated ? "true" : "false");
      form.append("parent_a_mint", restored?.parent_a_mint || "");
      form.append("parent_b_mint", restored?.parent_b_mint || "");
      form.append("rights_confirmed", "true");
      form.append("risk_confirmed", "true");
      const pinned = await pinMetadata(form);
      const mixDraft = readDraftMix();
      const record: PendingLaunch = {
        token: null,
        creator: null,
        metadata_uri: pinned.metadata_uri,
        image_uri: pinned.image_uri,
        image_cid: pinned.image_cid,
        metadata_cid: pinned.metadata_cid,
        image_hash: pinned.image_sha256,
        tx_hash: null,
        created_at: new Date().toISOString(),
        state: "prepared",
        name: pinned.name,
        ticker: pinned.ticker,
        parent_a: fromMix ? mixDraft.parent_a?.name : undefined,
        parent_b: fromMix ? mixDraft.parent_b?.name : undefined,
        generated,
      };
      writePendingLaunch(record);
      setPending(record);
      setPinResult(pinned);
      setPhase("REVIEWING");
      track("launch_review_opened");
    } catch (err: unknown) {
      setPhase("RECOVERABLE_FAILURE");
      if (err instanceof LaunchApiError) setError(err.message);
      else setError(err instanceof Error ? err.message : "Metadata pinning failed. Retry pinning.");
    }
  }

  function resumePending() {
    const record = readPendingLaunch();
    if (!record) return;
    setPinResult({
      image_uri: record.image_uri || "",
      image_cid: record.image_cid || "",
      metadata_uri: record.metadata_uri,
      metadata_cid: record.metadata_cid || "",
      image_sha256: record.image_hash,
      name: record.name || name.trim(),
      ticker: record.ticker || tickerValue,
    });
    setPending(record);
    setPhase("REVIEWING");
    setError("");
    track("launch_review_opened");
  }

  function discardPending() {
    clearPendingLaunch();
    setPending(null);
    setPinResult(null);
    setPhase("EDITING");
  }

  const preview = useMemo(
    () => (
      <LivePreview
        name={name}
        ticker={tickerValue}
        description={description}
        avatarSrc={avatarSrc}
        twitter={twitter}
        telegram={telegram}
        website={website}
        generated={generated}
      />
    ),
    [name, tickerValue, description, avatarSrc, twitter, telegram, website, generated],
  );

  if (phase === "REVIEWING" && pinResult) {
    return (
      <LaunchReview
        name={name.trim() || pinResult.name}
        ticker={tickerValue || pinResult.ticker}
        description={description}
        avatarSrc={avatarSrc}
        imageHash={pinResult.image_sha256}
        metadataUri={pinResult.metadata_uri}
        imageUri={pinResult.image_uri}
        twitter={twitter}
        telegram={telegram}
        website={website}
        initialBuy={normalizeInitialBuy(initialBuy)}
        generated={generated}
        nameCheck={nameCheck}
        onBack={() => setPhase("EDITING")}
      />
    );
  }

  return (
    <section className="page launch-page">
      {cropFile ? (
        <AvatarCropper
          file={cropFile}
          onCancel={() => setCropFile(null)}
          onConfirm={(blob) => {
            setAvatarSrc(setMemoryAvatar(blob));
            setLostAvatar(false);
            setCropFile(null);
          }}
        />
      ) : null}

      <header className="page-head">
        <div className="stack sm">
          <p className="eyebrow">Launch a token</p>
          <h1>{fromMix ? "Review before anything is signed" : "Direct launch does not wait for AI"}</h1>
        </div>
      </header>

      <div className="launch-layout">
        <form
          className="form-grid launch-form"
          onSubmit={(event) => {
            event.preventDefault();
            void onReview();
          }}
        >
          <div className="note-stack">
            {!appConfig.mainnet ? <p className="note warn">{DEVNET_LAUNCH_NOTICE}</p> : null}
            <p className="note warn">{boundary.reason}</p>
            {fromMix ? <p className="metric-label">Fields came from Mix. Edit anything before review</p> : null}
            {!appConfig.enableAiText || !appConfig.enableAiImage ? (
              <p className="metric-label">AI tools can be offline. Direct Launch still works</p>
            ) : null}
          </div>

          {pending?.state === "prepared" || pending?.state === "submitted" || pending?.state === "unknown" ? (
            <div className="panel recovery-banner">
              <p className="eyebrow">Unfinished launch</p>
              <p className="body-copy">
                {pending.state === "submitted"
                  ? "A launch transaction may already have been sent. Reconcile before creating a new token."
                  : appConfig.enableNativeLaunch
                    ? "Metadata is pinned. Resume review to build the launch transaction."
                    : "Metadata is pinned. Launching is switched off in this build."}
              </p>
              <div className="btn-row">
                <Button type="button" variant="secondary" onClick={resumePending}>
                  Resume review
                </Button>
                <Button type="button" variant="ghost" onClick={discardPending}>
                  Discard prepared record
                </Button>
              </div>
            </div>
          ) : null}

          {lostAvatar ? (
            <p className="note warn">
              The unpinned avatar stayed in this tab. Reload cleared it before pinning. Upload one to continue.
            </p>
          ) : null}
          {error ? <p className="note error">{error}</p> : null}
          {phase === "PINNING_METADATA" ? <p className="metric-label">Pinning metadata…</p> : null}
          {phase === "RECOVERABLE_FAILURE" ? (
            <p className="metric-label">Pinning failed. Edit the form and retry. Nothing was signed.</p>
          ) : null}

          <div className="avatar-studio launch-avatar">
            <div className="avatar-studio-frame">
              {avatarSrc ? (
                <img className="avatar" src={avatarSrc} alt={`${name || "Token"} avatar`} width={1024} height={1024} />
              ) : (
                <div className="avatar placeholder" aria-hidden="true" />
              )}
            </div>
            <div className="btn-row">
              <FileButton variant="outline" onFile={onPickAvatar}>
                {avatarSrc ? "Replace avatar" : "Upload avatar"}
              </FileButton>
              <span className="metric-label">Square crop, 1024 × 1024 PNG. No SVG, max 5 MB</span>
            </div>
          </div>

          <label className="field">
            <span>
              Name<span>{name.trim().length}/{NAME_MAX}</span>
            </span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={NAME_MAX}
              autoComplete="off"
            />
          </label>

          <label className="field">
            <span>
              Ticker<span>{tickerValue.length}/6</span>
            </span>
            <span className="ticker-input">
              <span aria-hidden="true">$</span>
              <input
                value={tickerValue}
                onChange={(event) => setTicker(event.target.value)}
                maxLength={6}
                inputMode="text"
                autoCapitalize="characters"
                autoComplete="off"
              />
            </span>
          </label>

          <label className="field">
            <span>
              Description<span>{description.trim().length}/{DESCRIPTION_MAX}</span>
            </span>
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={DESCRIPTION_MAX}
            />
          </label>

          <details
            className="disclosure"
            open={socialsOpen}
            onToggle={(event) => setSocialsOpen(event.currentTarget.open)}
          >
            <summary>Social links</summary>
            <div className="disclosure-body">
              <p className="metric-label">
                Links are stored in token metadata. Check them carefully; they may be permanent.
              </p>
              <label className="field">
                <span>X</span>
                <input value={twitter} onChange={(event) => setTwitter(event.target.value)} placeholder="https://x.com/..." />
                {twitterError(twitter) ? <span className="note error">{twitterError(twitter)}</span> : null}
              </label>
              <label className="field">
                <span>Telegram</span>
                <input value={telegram} onChange={(event) => setTelegram(event.target.value)} placeholder="https://t.me/..." />
                {telegramError(telegram) ? <span className="note error">{telegramError(telegram)}</span> : null}
              </label>
              <label className="field">
                <span>Website</span>
                <input value={website} onChange={(event) => setWebsite(event.target.value)} placeholder="https://" />
                {websiteError(website) ? <span className="note error">{websiteError(website)}</span> : null}
              </label>
            </div>
          </details>

          <details
            className="disclosure"
            open={advancedOpen}
            onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}
          >
            <summary>Advanced · optional initial buy</summary>
            <div className="disclosure-body">
              <p className="metric-label">
                Default is 0 ETH: create without buy. The opening buy is never turned on automatically, and it is a second signature after the token exists.
              </p>
              <div className="btn-row tight">
                {INITIAL_BUY_PRESETS.map((preset) => (
                  <Button
                    key={preset}
                    type="button"
                    size="sm"
                    variant="outline"
                    className={normalizeInitialBuy(initialBuy) === preset ? "is-on" : ""}
                    onClick={() => setInitialBuy(preset)}
                  >
                    {preset} ETH
                  </Button>
                ))}
              </div>
              <label className="field">
                <span>Custom ETH</span>
                <input value={initialBuy} onChange={(event) => setInitialBuy(event.target.value)} inputMode="decimal" />
                {buyError ? <span className="note error">{buyError}</span> : null}
              </label>
              <p className="metric-label">Wallet balance is checked at sign time. Slippage 1% conservative default.</p>
            </div>
          </details>

          {nameCheck ? (
            <p className="metric-label">
              {nameCheck.check_available
                ? `Exact name matches: ${nameCheck.name_matches}. Exact ticker matches: ${nameCheck.ticker_matches}. ${nameCheck.notice}`
                : nameCheck.notice}
            </p>
          ) : null}

          <details className="disclosure launch-mobile-preview">
            <summary>Preview</summary>
            <div className="disclosure-body">
              {preview}
              <CostSummary initialBuy={normalizeInitialBuy(buyError ? "0" : initialBuy)} />
            </div>
          </details>

          <label className="confirm-row">
            <input type="checkbox" checked={rights} onChange={(event) => setRights(event.currentTarget.checked)} />
            I own or have permission to use the submitted name, image and links.
          </label>
          <label className="confirm-row">
            <input type="checkbox" checked={risk} onChange={(event) => setRisk(event.currentTarget.checked)} />
            I understand that token launches and markets are risky and FONS does not guarantee value or liquidity.
          </label>

          <Button
            type="submit"
            variant="primary"
            size="lg"
            arrow
            disabled={!canReview || phase === "PINNING_METADATA"}
          >
            {phase === "PINNING_METADATA" ? "Pinning…" : "Review launch"}
          </Button>
          <p className="metric-label">
            Ticker must be 1–6 letters or numbers. SIGN &amp; LAUNCH stays off until wallet, simulation, and program
            allowlist pass.
          </p>
        </form>

        <aside className="launch-aside">
          <div className="panel stack launch-aside-inner">
            <p className="eyebrow">Live preview</p>
            {preview}
            <p className="eyebrow">Cost summary</p>
            <CostSummary initialBuy={normalizeInitialBuy(buyError ? INITIAL_BUY_DEFAULT : initialBuy)} />
          </div>
        </aside>
      </div>
    </section>
  );
}
