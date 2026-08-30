import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { appConfig } from "../../app/config";
import { BornMascot, type BornState } from "../../components/brand/BornMascot";
import { ParentPicker } from "../../components/mix/ParentPicker";
import { Button, ButtonAnchor, ButtonLink, FileButton } from "../../components/ui/Button";
import { setMemoryAvatar } from "../../domain/avatarMemory";
import {
  mixState,
  readDraftMix,
  writeDraftMix,
  writeDraftToken,
  type MixConcept,
  type ParentToken,
} from "../../domain/draft";
import { isPublicImageUrl } from "../../domain/handoff";
import { fileToSquarePng } from "../../domain/imageCrop";
import {
  DESCRIPTION_MAX,
  isValidDescription,
  isValidName,
  isValidTicker,
  NAME_MAX,
  normalizeTicker,
} from "../../domain/validation";
import { MixApiError, avatarJobStatus, mixConcepts, startAvatarJob } from "../../services/api";
import { track } from "../../services/analytics";

const ANALYZE_LABELS = ["Reading Parent A", "Reading Parent B", "Finding the mutation"];
const DRAW_LABELS = ["Drawing the avatar", "Cleaning the result"];

function usableReference(token: ParentToken | null, file: File | null): boolean {
  if (file) return true;
  const url = token?.image_url || "";
  if (!url || url.startsWith("blob:")) return false;
  if (url.toLowerCase().endsWith(".svg")) return false;
  return url.startsWith("http://") || url.startsWith("https://") || url.startsWith("/assets/");
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(resolve, ms);
    const onAbort = () => {
      window.clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export function MixPage() {
  const navigate = useNavigate();
  const stored = readDraftMix();
  const initialSelected =
    (stored.concepts ?? []).find((item) => item.id === stored.selected_concept_id) ?? stored.concepts?.[0] ?? null;
  const [parentA, setParentA] = useState<ParentToken | null>(stored.parent_a);
  const [parentB, setParentB] = useState<ParentToken | null>(stored.parent_b);
  const [refA, setRefA] = useState<File | null>(null);
  const [refB, setRefB] = useState<File | null>(null);
  const [concepts, setConcepts] = useState<MixConcept[]>(stored.concepts ?? []);
  const [selectedId, setSelectedId] = useState<string | null>(initialSelected?.id ?? null);
  const [name, setName] = useState(initialSelected?.name ?? "");
  const [ticker, setTicker] = useState(initialSelected?.ticker ?? "");
  const [description, setDescription] = useState(initialSelected?.description ?? "");
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeLabel, setAnalyzeLabel] = useState(ANALYZE_LABELS[0]);
  const [error, setError] = useState("");
  const [fallbackNotice, setFallbackNotice] = useState(
    (stored.concepts ?? []).length ? stored.fallback_notice ?? "" : "",
  );
  const [cooldown, setCooldown] = useState(0);
  const [drawing, setDrawing] = useState(false);
  const [drawLabel, setDrawLabel] = useState(DRAW_LABELS[0]);
  const [avatarError, setAvatarError] = useState("");
  const [jobToken, setJobToken] = useState(stored.avatar_job_token ?? "");
  const [avatarUrl, setAvatarUrl] = useState(stored.avatar_result_url ?? "");
  const [lastGeneratedUrl, setLastGeneratedUrl] = useState(stored.avatar_result_url ?? "");
  const [replaced, setReplaced] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const drawAbort = useRef<AbortController | null>(null);
  const drawingLock = useRef(false);

  const tickerValue = normalizeTicker(ticker);
  const state = mixState({ parentA, parentB, analyzing, concepts, selectedId, error });
  const duplicate = Boolean(parentA && parentB && parentA.mint.toLowerCase() === parentB.mint.toLowerCase());
  const selected = concepts.find((item) => item.id === selectedId) ?? null;
  const fieldsValid = isValidName(name) && isValidTicker(tickerValue) && isValidDescription(description);
  const mutateDisabled =
    !appConfig.enableAiText ||
    !parentA ||
    !parentB ||
    duplicate ||
    analyzing ||
    cooldown > 0;
  const canGenerate =
    Boolean(selected) &&
    usableReference(parentA, refA) &&
    usableReference(parentB, refB) &&
    !drawing &&
    appConfig.enableAiImage;
  const previewSrc = avatarUrl || "";
  const mascot: BornState = drawing
    ? "generating"
    : analyzing
      ? "mixing"
      : error || avatarError
        ? "warning"
        : previewSrc
          ? "success"
          : selected
            ? "ready"
            : parentA && parentB
              ? "ready"
              : parentA || parentB
                ? "searching"
                : "idle";
  const stepIndex = previewSrc ? 3 : concepts.length ? 2 : 1;

  useEffect(() => {
    writeDraftMix({
      parent_a: parentA,
      parent_b: parentB,
      concepts,
      selected_concept_id: selectedId,
      fallback: Boolean(fallbackNotice),
      fallback_notice: fallbackNotice || null,
      avatar_job_token: jobToken || null,
      avatar_result_url: isPublicImageUrl(avatarUrl) ? avatarUrl : null,
    });
  }, [parentA, parentB, concepts, selectedId, fallbackNotice, jobToken, avatarUrl]);

  useEffect(() => {
    if (!analyzing) return;
    let index = 0;
    setAnalyzeLabel(ANALYZE_LABELS[0]);
    const timer = window.setInterval(() => {
      index = (index + 1) % ANALYZE_LABELS.length;
      setAnalyzeLabel(ANALYZE_LABELS[index]);
    }, 900);
    return () => window.clearInterval(timer);
  }, [analyzing]);

  useEffect(() => {
    if (!drawing) return;
    let index = 0;
    setDrawLabel(DRAW_LABELS[0]);
    const timer = window.setInterval(() => {
      index = (index + 1) % DRAW_LABELS.length;
      setDrawLabel(DRAW_LABELS[index]);
    }, 1400);
    return () => window.clearInterval(timer);
  }, [drawing]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setTimeout(() => setCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  useEffect(() => {
    if (!stored.avatar_job_token || stored.avatar_result_url) return;
    void resumeJob(stored.avatar_job_token);
    // resume once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!previewSrc || isPublicImageUrl(previewSrc)) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [previewSrc]);

  function applyConcept(concept: MixConcept, fromUser = false) {
    setSelectedId(concept.id);
    setName(concept.name);
    setTicker(concept.ticker);
    setDescription(concept.description);
    if (fromUser) track("mix_concept_selected");
  }

  function onSelectParent(side: "a" | "b", token: ParentToken) {
    const other = side === "a" ? parentB : parentA;
    if (other && other.mint.toLowerCase() === token.mint.toLowerCase()) {
      setError("Parents must be different.");
      return;
    }
    setError("");
    setConcepts([]);
    setSelectedId(null);
    setFallbackNotice("");
    setAvatarUrl("");
    setJobToken("");
    if (side === "a") {
      setParentA(token);
      setRefA(null);
      track("parent_selected_a");
    } else {
      setParentB(token);
      setRefB(null);
      track("parent_selected_b");
    }
  }

  async function onReferenceFile(side: "a" | "b", file: File) {
    const parent = side === "a" ? parentA : parentB;
    if (!parent) return;
    try {
      const square = await fileToSquarePng(file);
      const next = new File([square], `${side}.png`, { type: "image/png" });
      const url = URL.createObjectURL(square);
      if (side === "a") {
        setRefA(next);
        setParentA({ ...parent, image_url: url });
      } else {
        setRefB(next);
        setParentB({ ...parent, image_url: url });
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "This token has no usable image. Upload one to continue.");
    }
  }

  async function mutate() {
    if (!parentA || !parentB || mutateDisabled) return;
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setAnalyzing(true);
    setError("");
    setCooldown(8);
    track("mix_requested");
    try {
      const result = await mixConcepts(parentA, parentB, "", controller.signal);
      setConcepts(result.concepts);
      setFallbackNotice(result.fallback ? result.fallback_notice || "Basic mix mode — AI logic is temporarily unavailable." : "");
      const recommended = result.concepts.find((item) => item.recommended) || result.concepts[0];
      if (recommended) applyConcept(recommended);
      track("mix_concepts_ready", { fallback: result.fallback });
    } catch (err: unknown) {
      const message =
        err instanceof MixApiError
          ? err.message
          : "The logic mixer took too long. Nothing was charged for an avatar.";
      setError(message);
      setConcepts([]);
      if (err instanceof MixApiError && err.code === "RATE_LIMITED") {
        const seconds = Number((message.match(/(\d+)/) || [])[1] || 8);
        setCooldown(seconds);
      }
    } finally {
      setAnalyzing(false);
    }
  }

  async function generateAvatar() {
    if (!canGenerate || !parentA || !parentB || !selected || drawingLock.current) return;
    drawingLock.current = true;
    drawAbort.current?.abort();
    const controller = new AbortController();
    drawAbort.current = controller;
    setDrawing(true);
    setAvatarError("");
    setReplaced(false);
    track("avatar_requested");
    try {
      const form = new FormData();
      form.append("style", "mixborn_lofi_v1");
      form.append("name", name.trim());
      form.append("ticker", tickerValue);
      form.append("description", description.trim());
      form.append("character_hook", selected.hook || selected.internal?.character_hook || name.trim());
      form.append("parent_a_trait", selected.internal?.parent_a_trait || "");
      form.append("parent_b_trait", selected.internal?.parent_b_trait || "");
      form.append("visual_prompt", selected.internal?.visual_prompt || "");
      if (refA) form.append("parent_a_image", refA, "parent_a.png");
      else if (parentA.image_url && !parentA.image_url.startsWith("blob:")) form.append("parent_a_url", parentA.image_url);
      if (refB) form.append("parent_b_image", refB, "parent_b.png");
      else if (parentB.image_url && !parentB.image_url.startsWith("blob:")) form.append("parent_b_url", parentB.image_url);
      const started = await startAvatarJob(form, controller.signal);
      setJobToken(started.job_token);
      await pollJob(started.job_token, controller.signal);
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setAvatarError("Generation stopped in this tab. Retry to start one new drawing.");
      } else {
        setAvatarError(
          err instanceof MixApiError
            ? err.message
            : "The drawing is still processing. You can keep this tab open or retry later.",
        );
        track("avatar_failed");
      }
    } finally {
      drawingLock.current = false;
      setDrawing(false);
    }
  }

  async function resumeJob(token: string) {
    if (drawingLock.current) return;
    drawingLock.current = true;
    const controller = new AbortController();
    drawAbort.current = controller;
    setDrawing(true);
    setAvatarError("");
    try {
      await pollJob(token, controller.signal);
    } catch (err: unknown) {
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        setAvatarError(
          err instanceof MixApiError
            ? err.message
            : "The drawing is still processing. You can keep this tab open or retry later.",
        );
        track("avatar_failed");
      }
    } finally {
      drawingLock.current = false;
      setDrawing(false);
    }
  }

  async function pollJob(token: string, signal: AbortSignal) {
    const began = Date.now();
    while (Date.now() - began < 150_000) {
      const elapsed = Date.now() - began;
      const wait = document.hidden ? 8000 : elapsed < 15_000 ? 1500 : 3000;
      await sleep(wait, signal);
      const status = await avatarJobStatus(token, signal);
      if (status.status === "completed" && status.image_url) {
        setAvatarUrl(status.image_url);
        setLastGeneratedUrl(status.image_url);
        track("avatar_completed");
        try {
          const image = await fetch(status.image_url, { signal });
          if (image.ok) setMemoryAvatar(await image.blob());
        } catch {
          // Preview can still use the public URL if the blob copy is blocked.
        }
        return;
      }
      if (status.status === "failed" || status.status === "expired") {
        throw new MixApiError(
          status.code || "IMAGE_REJECTED",
          status.message || "This combination could not be rendered. Edit the concept or upload an image.",
        );
      }
    }
    throw new MixApiError(
      "IMAGE_TIMEOUT",
      "The drawing is still processing. You can keep this tab open or retry later.",
    );
  }

  async function replaceAvatar(file: File) {
    try {
      const square = await fileToSquarePng(file);
      const url = setMemoryAvatar(square);
      setAvatarUrl(url);
      setReplaced(true);
      setAvatarError("");
    } catch (err: unknown) {
      setAvatarError(err instanceof Error ? err.message : "Upload a PNG, JPEG, or WebP image.");
    }
  }

  function restoreGenerated() {
    if (!lastGeneratedUrl) return;
    setAvatarUrl(lastGeneratedUrl);
    setReplaced(false);
  }

  function useInLaunch() {
    if (!fieldsValid || !parentA || !parentB) return;
    writeDraftToken({
      source: "ai_mix",
      name: name.trim(),
      ticker: tickerValue,
      description: description.trim(),
      parent_a_mint: parentA.mint,
      parent_b_mint: parentB.mint,
      mix_strategy: selected?.internal?.strategy,
      generated: Boolean(lastGeneratedUrl) && !replaced,
      avatar_url: isPublicImageUrl(avatarUrl) ? avatarUrl : undefined,
    });
    track("draft_sent_to_launch");
    navigate("/app/launch?source=mix");
  }

  const inheritance = useMemo(() => {
    const internal = selected?.internal;
    if (!internal?.parent_a_trait && !internal?.parent_b_trait) return "";
    return `From A: ${internal.parent_a_trait || "Unknown"}. From B: ${internal.parent_b_trait || "Unknown"}.`;
  }, [selected]);

  const clearSide = (side: "a" | "b") => {
    if (side === "a") {
      setParentA(null);
      setRefA(null);
    } else {
      setParentB(null);
      setRefB(null);
    }
    setConcepts([]);
    setSelectedId(null);
    setFallbackNotice("");
    setAvatarUrl("");
  };

  return (
    <section className={`page mix-page${analyzing || drawing ? " is-locked" : ""}`}>
      <header className="page-head">
        <div className="stack sm">
          <p className="eyebrow">Create a mutation</p>
          <h1>Pick two existing tokens. We mix their logic, not their charts.</h1>
        </div>
        <ol className="step-rail" aria-label="Progress">
          {["Parents", "Concept", "Avatar"].map((label, index) => (
            <li key={label} className={index + 1 <= stepIndex ? "is-done" : ""}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              {label}
            </li>
          ))}
        </ol>
      </header>

      <div className="stack sm">
        {!appConfig.enableAiText ? (
          <p className="note error">The logic mixer is offline. Direct Launch is still available.</p>
        ) : null}
        {duplicate ? <p className="note error">Parents must be different.</p> : null}
        {error ? (
          <p className="note error">
            {error}
            <Button type="button" variant="ghost" size="sm" onClick={() => void mutate()}>
              Retry
            </Button>
          </p>
        ) : null}
        {fallbackNotice ? <p className="note warn">{fallbackNotice}</p> : null}
      </div>

      {/* ------------------------------------------------------ the console */}
      <div className="panel flush mix-console">
        <div className="chrome-bar">
          <span>
            <i className="dot" aria-hidden="true" />
            MUTATION_BENCH
          </span>
          <span>{analyzing ? analyzeLabel : drawing ? drawLabel : "IDLE"}</span>
        </div>
        <div className="mix-console-body">
          <ParentPicker
            side="a"
            selected={parentA}
            otherMint={parentB?.mint}
            locked={analyzing || drawing}
            onSelect={(token) => onSelectParent("a", token)}
            onReferenceFile={(file) => void onReferenceFile("a", file)}
            onClear={() => clearSide("a")}
          />
          <div className="mix-core">
            <BornMascot
              variant="portrait"
              state={mascot}
              parentA={Boolean(parentA)}
              parentB={Boolean(parentB)}
              className="bare sz-md"
              caption={analyzing ? "mixing" : drawing ? "drawing" : "operator"}
            />
          </div>
          <ParentPicker
            side="b"
            selected={parentB}
            otherMint={parentA?.mint}
            locked={analyzing || drawing}
            onSelect={(token) => onSelectParent("b", token)}
            onReferenceFile={(file) => void onReferenceFile("b", file)}
            onClear={() => clearSide("b")}
          />
        </div>
        <div className="mix-console-foot">
          {state === "EMPTY" ? (
            <p className="metric-label">Two empty slots. That is usually how trouble starts.</p>
          ) : (
            <p className="metric-label">
              {analyzing ? analyzeLabel : "One mutation reads both parents and returns three concepts."}
            </p>
          )}
          <div className="btn-row">
            <ButtonLink to="/app/launch" variant="ghost">
              Direct Launch
            </ButtonLink>
            <Button type="button" variant="primary" arrow disabled={mutateDisabled} onClick={() => void mutate()}>
              {analyzing ? "Mutating…" : cooldown > 0 ? `Mutate (${cooldown})` : "Mutate"}
            </Button>
          </div>
        </div>
      </div>

      {/* ------------------------------------------------------ the result */}
      {concepts.length > 0 ? (
        <div className="mix-result">
          <aside className="concept-column">
            <p className="eyebrow">Three concepts</p>
            <p className="metric-label">
              {inheritance || "Inheritance appears after a concept is chosen."}
            </p>
            <div className="concept-list">
              {concepts.map((concept) => (
                <button
                  key={concept.id}
                  type="button"
                  className={`concept-card${concept.id === selectedId ? " is-active" : ""}`}
                  aria-pressed={concept.id === selectedId}
                  onClick={() => applyConcept(concept, true)}
                >
                  <span className="concept-card-head">
                    <strong>{concept.name}</strong>
                    <em>${concept.ticker}</em>
                  </span>
                  <span className="concept-card-hook">
                    {concept.hook || concept.internal?.character_hook || concept.description}
                  </span>
                  {concept.recommended ? <span className="chip copper">Recommended</span> : null}
                </button>
              ))}
            </div>
          </aside>

          <form className="panel form-grid concept-form" onSubmit={(event) => event.preventDefault()}>
            <p className="eyebrow">Generated token</p>

            <div className="avatar-studio">
              <div className="avatar-studio-frame">
                {previewSrc ? (
                  <img
                    className="avatar"
                    src={previewSrc}
                    alt={`${name || "Generated"} avatar`}
                    width={1024}
                    height={1024}
                  />
                ) : (
                  <div className="avatar placeholder" aria-hidden="true" />
                )}
                {drawing ? <p className="avatar-busy">{drawLabel}</p> : null}
              </div>

              {avatarError ? (
                <p className="note error">
                  {avatarError}
                  <Button type="button" variant="ghost" size="sm" onClick={() => void generateAvatar()}>
                    Retry
                  </Button>
                </p>
              ) : null}
              {!appConfig.enableAiImage ? (
                <p className="metric-label">Avatar generation is offline. Upload your own or use Direct Launch.</p>
              ) : null}
              {selected && (!usableReference(parentA, refA) || !usableReference(parentB, refB)) ? (
                <p className="note warn">This token has no usable image. Upload one to continue.</p>
              ) : null}

              <div className="btn-row">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={!canGenerate}
                  onClick={() => void generateAvatar()}
                >
                  {previewSrc && !replaced ? "Regenerate avatar" : "Generate avatar"}
                </Button>
                <FileButton variant="ghost" onFile={(file) => void replaceAvatar(file)}>
                  Replace upload
                </FileButton>
                {replaced && lastGeneratedUrl ? (
                  <Button type="button" variant="ghost" onClick={restoreGenerated}>
                    Restore generated
                  </Button>
                ) : null}
                {previewSrc ? (
                  <ButtonAnchor
                    variant="ghost"
                    href={previewSrc}
                    download={`${tickerValue || "mixborn"}-avatar.png`}
                  >
                    Download
                  </ButtonAnchor>
                ) : null}
              </div>
              {previewSrc && !replaced ? (
                <p className="metric-label">Regenerate avatar starts one new billable drawing.</p>
              ) : null}
            </div>

            <label className="field">
              <span>
                Name<span>{name.trim().length}/{NAME_MAX}</span>
              </span>
              <input value={name} onChange={(event) => setName(event.target.value)} maxLength={NAME_MAX} />
            </label>
            <label className="field">
              <span>
                Ticker<span>{tickerValue.length}/6</span>
              </span>
              <span className="ticker-input">
                <span aria-hidden="true">$</span>
                <input value={tickerValue} onChange={(event) => setTicker(event.target.value)} maxLength={6} />
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

            <Button type="button" variant="primary" size="lg" arrow disabled={!fieldsValid} onClick={useInLaunch}>
              Use in Launch
            </Button>
            <p className="metric-label">
              This hands the draft to the launch form. No wallet opens, nothing is signed.
            </p>
          </form>
        </div>
      ) : null}
    </section>
  );
}
