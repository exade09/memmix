import { useEffect, useMemo, useRef, useState } from "react";
import { LayoutGroup, motion, useReducedMotion } from "motion/react";
import { appConfig, clusterLabel } from "../../app/config";
import { BornMascot, type BornState } from "../../components/brand/BornMascot";
import { MergeCore } from "../../components/brand/MergeCore";
import { SafetyBanner } from "../../components/layout/SafetyBanner";
import { SiteFooter } from "../../components/layout/SiteFooter";
import { SectionReveal } from "../../components/motion/SectionReveal";
import { SearchResultButton, TokenFeedCard, TokenSkeleton, toParent } from "../../components/token/TokenFeedCard";
import { Button, ButtonLink } from "../../components/ui/Button";
import { FAQ_ITEMS, SAFETY_PILLARS } from "../../domain/legalCopy";
import { readDraftMix, setDraftParent, type ParentToken } from "../../domain/draft";
import { track } from "../../services/analytics";
import { fetchFeedResult, searchTokensResult, type TokenSummary } from "../../services/api";

const HOW = [
  ["01", "Pick", "Search any two Solana tokens. Name, ticker, mint or a Pump link all work."],
  ["02", "Mutate", "AI finds a logical connection between them, not a lazy word splice."],
  ["03", "Edit", "Keep only the name, ticker, description and avatar you actually want."],
  ["04", "Launch", "Review the exact wallet debit, then sign it yourself."],
] as const;

/*
  Facts, not vanity counters. Every number here is something the app can
  actually stand behind.
*/
const FACTS = [
  ["Parents in", "2", "Two existing tokens, never one"],
  ["AI outputs", "4", "Name, ticker, description, one avatar"],
  ["Platform launch fee", "0 SOL", "Network fees and rent still cost SOL"],
  ["Custody", "None", "Your keys never leave your wallet"],
] as const;

const SAFETY_INDEXED = SAFETY_PILLARS.map(([title, copy], index) => [
  String(index + 1).padStart(2, "0"),
  title,
  copy,
] as const);

const MINT_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function LandingPage() {
  const reduceMotion = useReducedMotion();
  const [parentA, setParentA] = useState<ParentToken | null>(null);
  const [parentB, setParentB] = useState<ParentToken | null>(null);
  const [queryA, setQueryA] = useState("");
  const [queryB, setQueryB] = useState("");
  const [resultsA, setResultsA] = useState<TokenSummary[]>([]);
  const [resultsB, setResultsB] = useState<TokenSummary[]>([]);
  const [searchError, setSearchError] = useState("");
  const [duplicateError, setDuplicateError] = useState("");
  const [feed, setFeed] = useState<TokenSummary[]>([]);
  const [feedError, setFeedError] = useState("");
  const [feedLoading, setFeedLoading] = useState(true);
  const [feedUpdatedAt, setFeedUpdatedAt] = useState("");
  const [feedCached, setFeedCached] = useState(false);
  const [feedTab, setFeedTab] = useState<"trending" | "new" | "mixable">("trending");
  const abortA = useRef<AbortController | null>(null);
  const abortB = useRef<AbortController | null>(null);
  const timerA = useRef(0);
  const timerB = useRef(0);

  useEffect(() => {
    const draft = readDraftMix();
    setParentA(draft.parent_a);
    setParentB(draft.parent_b);
  }, []);

  const mascotState = useMemo<BornState>(() => {
    if (duplicateError) return "warning";
    if (parentA && parentB) return "ready";
    if (parentA || parentB || queryA || queryB) return "searching";
    return "idle";
  }, [parentA, parentB, queryA, queryB, duplicateError]);

  useEffect(() => {
    let cancelled = false;
    setFeedLoading(true);
    fetchFeedResult({ tab: feedTab, limit: 6 })
      .then((result) => {
        if (!cancelled) {
          setFeed(result.tokens);
          setFeedUpdatedAt(result.generated_at || "");
          setFeedCached(result.data_source === "local-fallback");
          setFeedError("");
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setFeed([]);
          setFeedError(error instanceof Error ? error.message : "Feed unavailable");
        }
      })
      .finally(() => {
        if (!cancelled) setFeedLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [feedTab]);

  function scheduleSearch(side: "a" | "b", value: string) {
    const timer = side === "a" ? timerA : timerB;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      void runSearch(side, value);
    }, 250);
  }

  async function runSearch(side: "a" | "b", value: string) {
    const query = value.trim();
    const abortRef = side === "a" ? abortA : abortB;
    abortRef.current?.abort();
    if (query.length < 2 && !MINT_RE.test(query)) {
      if (side === "a") setResultsA([]);
      else setResultsB([]);
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const result = await searchTokensResult(query, 8, controller.signal);
      if (side === "a") setResultsA(result.items);
      else setResultsB(result.items);
      setSearchError(
        result.collision_warning ||
          (result.items.length === 0 ? "Nothing matched those filters. Loosen them a little." : ""),
      );
    } catch (error: unknown) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      if (side === "a") setResultsA([]);
      else setResultsB([]);
      setSearchError("The scanner is offline. Try a mint address or retry.");
    }
  }

  function selectParent(side: "a" | "b", token: TokenSummary) {
    if (!token.mint) return;
    const other = side === "a" ? parentB : parentA;
    if (other && other.mint === token.mint) {
      setDuplicateError("Parents must be different.");
      return;
    }
    const parent = toParent(token);
    setDraftParent(side, parent);
    setDuplicateError("");
    setSearchError("");
    if (side === "a") {
      setParentA(parent);
      setQueryA("");
      setResultsA([]);
    } else {
      setParentB(parent);
      setQueryB("");
      setResultsB([]);
    }
  }

  function clearParent(side: "a" | "b") {
    setDuplicateError("");
    if (side === "a") {
      setParentA(null);
      setDraftParent("a", null);
    } else {
      setParentB(null);
      setDraftParent("b", null);
    }
  }

  function assignedSide(token: TokenSummary): "a" | "b" | null {
    if (parentA?.mint === token.mint) return "a";
    if (parentB?.mint === token.mint) return "b";
    return null;
  }

  return (
    <LayoutGroup>
      <div className="landing">
        {/* ---------------------------------------------------------- hero */}
        <section className="hero">
          <div className="wrap hero-inner">
            <div className="hero-copy">
              <p className="eyebrow">AI token lab · {clusterLabel()}</p>
              <h1>
                Two tokens in.
                <br />
                <span className="hero-born">One born.</span>
              </h1>
              <p className="lede">
                Mix the logic behind two Solana tokens. Get one new character with a name, a ticker and an avatar — then
                launch it on Pump without leaving the app.
              </p>
              <div className="btn-row hero-actions">
                <ButtonLink to="/app/mix" variant="primary" size="lg" arrow onClick={() => track("landing_primary_cta")}>
                  Start mixing
                </ButtonLink>
                <ButtonLink
                  to="/app/launch"
                  variant="outline"
                  size="lg"
                  onClick={() => track("landing_direct_launch_cta")}
                >
                  Launch without AI
                </ButtonLink>
              </div>
              <p className="metric-label hero-fineprint">
                No wallet prompt until you choose to sign. AI writes four fields and draws one avatar — nothing else.
              </p>
            </div>

            <div className="hero-figure">
              <BornMascot
                variant="full"
                state={mascotState}
                parentA={Boolean(parentA)}
                parentB={Boolean(parentB)}
                lit
                className="sz-hero"
                caption="BORN · operator"
              />
            </div>
          </div>

          {/* fact strip */}
          <div className="wrap">
            <dl className="fact-strip">
              {FACTS.map(([label, value, note]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                  <p>{note}</p>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* ------------------------------------------------------ the bench */}
        <SectionReveal className="section tight" ariaLabel="Mix bench">
          <div className="wrap">
            <div className="panel-head">
              <div>
                <p className="eyebrow">No wallet required</p>
                <h2>Start on the bench.</h2>
              </div>
              <p className="body-copy bench-intro">
                Drop two parents into the slots. The result opens in the full mixer — nothing is signed, nothing is spent.
              </p>
            </div>
            <MixBench
              parentA={parentA}
              parentB={parentB}
              queryA={queryA}
              queryB={queryB}
              resultsA={resultsA}
              resultsB={resultsB}
              searchError={searchError}
              duplicateError={duplicateError}
              reduceMotion={Boolean(reduceMotion)}
              onQueryA={(value) => {
                setQueryA(value);
                scheduleSearch("a", value);
              }}
              onQueryB={(value) => {
                setQueryB(value);
                scheduleSearch("b", value);
              }}
              onSelect={selectParent}
              onClear={clearParent}
            />
          </div>
        </SectionReveal>

        {/* --------------------------------------------------------- how it works */}
        <SectionReveal className="section raised" ariaLabel="Process">
          <div className="wrap">
            <div className="panel-head">
              <div>
                <p className="eyebrow">Process</p>
                <h2>From two memes to one mint.</h2>
              </div>
              <p className="body-copy">The lab does not predict the market. It makes new things for it.</p>
            </div>
            <ol className="step-grid">
              {HOW.map(([index, title, copy]) => (
                <li key={title} className="step-card">
                  <span className="step-index">{index}</span>
                  <h3>{title}</h3>
                  <p>{copy}</p>
                </li>
              ))}
            </ol>
          </div>
        </SectionReveal>

        {/* --------------------------------------------------------- two paths */}
        <SectionReveal className="section" ariaLabel="Two paths">
          <div className="wrap">
            <div className="path-grid">
              <article className="path-card is-a">
                <p className="eyebrow">AI Mix</p>
                <h2>I have two tokens. Make the third.</h2>
                <p className="body-copy">
                  Two parents in, one editable character out. The wallet stays out of it until you want it in.
                </p>
                <ButtonLink to="/app/mix" variant="primary" arrow onClick={() => track("landing_primary_cta")}>
                  Open the mixer
                </ButtonLink>
              </article>
              <article className="path-card is-b">
                <p className="eyebrow">Direct Launch</p>
                <h2>I already know what I am launching.</h2>
                <p className="body-copy">
                  Skip the mixer entirely. Name, ticker, image, links — then review and sign. Works with AI offline.
                </p>
                <ButtonLink to="/app/launch" variant="outline" arrow onClick={() => track("landing_direct_launch_cta")}>
                  Open the launchpad
                </ButtonLink>
              </article>
            </div>
          </div>
        </SectionReveal>

        {/* --------------------------------------------------------- live feed */}
        <SectionReveal className="section raised" ariaLabel="Live scan">
          <div className="wrap">
            <div className="panel-head">
              <div>
                <p className="eyebrow">Live scan</p>
                <h2>Pick something alive.</h2>
              </div>
              <div className="btn-row">
                <div className="segmented" role="group" aria-label="Feed filter">
                  {(["trending", "new", "mixable"] as const).map((tab) => (
                    <button key={tab} type="button" aria-pressed={feedTab === tab} onClick={() => setFeedTab(tab)}>
                      {tab}
                    </button>
                  ))}
                </div>
                <ButtonLink to="/app/explore" variant="ghost">
                  View all
                </ButtonLink>
              </div>
            </div>
            <div className="feed-meta">
              {feedUpdatedAt ? <span className="metric-label">Last updated {feedUpdatedAt}</span> : null}
              {feedCached ? <span className="chip warn">Cached examples · not live market data</span> : null}
            </div>
            {feedError ? (
              <p className="note error" role="status">
                {feedError} Retry the scanner or use a mint address.
              </p>
            ) : null}
            {!feedLoading && !feedError && feed.length === 0 ? (
              <p className="empty-state">Nothing matched those filters. Loosen them a little.</p>
            ) : null}
            <div className="feed-grid">
              {feedLoading
                ? Array.from({ length: 6 }, (_, index) => <TokenSkeleton key={index} />)
                : feed.map((token) => (
                    <TokenFeedCard
                      key={token.mint}
                      token={token}
                      assignedSide={assignedSide(token)}
                      onAssign={selectParent}
                    />
                  ))}
            </div>
          </div>
        </SectionReveal>

        {/* --------------------------------------------------------- BORN */}
        <SectionReveal id="mascot" className="section born-section" ariaLabel="Meet BORN">
          <div className="wrap born-section-inner">
            <div className="born-section-figure">
              <BornMascot variant="portrait" state="idle" quiet lit className="sz-lg" />
            </div>
            <div className="stack">
              <p className="eyebrow">Meet the operator</p>
              <h2>He does not predict the market. He makes new things for it.</h2>
              <p className="body-copy">
                BORN has no face — just the space where one should be. Feed him two tokens and that space does the work:
                one parent arrives warm, one arrives cold, they collide, and what comes out is a character that should not
                exist but somehow makes sense.
              </p>
              <p className="body-copy">
                He is a mascot, not an oracle. He will not tell you what to buy, and he will never ask for your keys.
              </p>
              <div className="btn-row">
                <ButtonLink to="/app/mix" variant="primary" arrow>
                  Enter the lab
                </ButtonLink>
              </div>
            </div>
          </div>
        </SectionReveal>

        {/* --------------------------------------------------------- safety */}
        <SectionReveal className="section raised" ariaLabel="Safety">
          <div className="wrap">
            <div className="panel-head">
              <div>
                <p className="eyebrow">Safety</p>
                <h2>Safe to sign. Never safe to assume.</h2>
              </div>
            </div>
            <div className="safety-layout">
              <ol className="pillar-grid">
                {SAFETY_INDEXED.map(([index, title, copy]) => (
                  <li key={title} className="pillar-card">
                    <span className="step-index">{index}</span>
                    <h3>{title}</h3>
                    <p>{copy}</p>
                  </li>
                ))}
              </ol>
              <SafetyBanner showFee />
            </div>
          </div>
        </SectionReveal>

        {/* --------------------------------------------------------- faq */}
        <SectionReveal className="section" ariaLabel="FAQ">
          <div className="wrap faq-layout">
            <div className="stack sm faq-head">
              <p className="eyebrow">FAQ</p>
              <h2>Before you sign.</h2>
              <p className="body-copy">
                {appConfig.productName} is an interface. Everything below describes what it can and cannot do.
              </p>
            </div>
            <div className="faq-list">
              {FAQ_ITEMS.map(([question, answer], index) => (
                <details key={question} className="disclosure faq-item">
                  <summary>
                    <span className="faq-index">{String(index + 1).padStart(2, "0")}</span>
                    {question}
                  </summary>
                  <div className="disclosure-body">
                    <p className="body-copy">{answer}</p>
                  </div>
                </details>
              ))}
            </div>
          </div>
        </SectionReveal>

        <SiteFooter />
      </div>
    </LayoutGroup>
  );
}

/* ------------------------------------------------------------------ bench */

function MixBench({
  parentA,
  parentB,
  queryA,
  queryB,
  resultsA,
  resultsB,
  searchError,
  duplicateError,
  reduceMotion,
  onQueryA,
  onQueryB,
  onSelect,
  onClear,
}: {
  parentA: ParentToken | null;
  parentB: ParentToken | null;
  queryA: string;
  queryB: string;
  resultsA: TokenSummary[];
  resultsB: TokenSummary[];
  searchError: string;
  duplicateError: string;
  reduceMotion: boolean;
  onQueryA: (value: string) => void;
  onQueryB: (value: string) => void;
  onSelect: (side: "a" | "b", token: TokenSummary) => void;
  onClear: (side: "a" | "b") => void;
}) {
  return (
    <div className="panel flush bench" aria-label="Mix bench">
      <div className="chrome-bar">
        <span>
          <i className="dot" aria-hidden="true" />
          MIX_BENCH
        </span>
        <span>NO WALLET REQUIRED</span>
      </div>
      <div className="bench-body">
        <div className="bench-row">
          <ParentSearch
            side="a"
            query={queryA}
            selected={parentA}
            results={resultsA}
            reduceMotion={reduceMotion}
            onQuery={onQueryA}
            onSelect={(token) => onSelect("a", token)}
            onClear={() => onClear("a")}
          />
          <span className="bench-op" aria-hidden="true">
            +
          </span>
          <ParentSearch
            side="b"
            query={queryB}
            selected={parentB}
            results={resultsB}
            reduceMotion={reduceMotion}
            onQuery={onQueryB}
            onSelect={(token) => onSelect("b", token)}
            onClear={() => onClear("b")}
          />
          <span className="bench-op" aria-hidden="true">
            →
          </span>
          <MergeCore parentA={parentA} parentB={parentB} />
        </div>

        {duplicateError ? (
          <p className="note error" role="status">
            {duplicateError}
          </p>
        ) : null}
        {searchError && !duplicateError ? (
          <p className="metric-label" role="status">
            {searchError}
          </p>
        ) : null}
        {parentA && parentB ? (
          <motion.div
            className="btn-row"
            initial={reduceMotion ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: reduceMotion ? 0.12 : 0.22 }}
          >
            <ButtonLink to="/app/mix" variant="primary" arrow>
              Start mutation
            </ButtonLink>
          </motion.div>
        ) : null}
      </div>
    </div>
  );
}

function ParentSearch({
  side,
  query,
  selected,
  results,
  reduceMotion,
  onQuery,
  onSelect,
  onClear,
}: {
  side: "a" | "b";
  query: string;
  selected: ParentToken | null;
  results: TokenSummary[];
  reduceMotion: boolean;
  onQuery: (value: string) => void;
  onSelect: (token: TokenSummary) => void;
  onClear: () => void;
}) {
  const label = side === "a" ? "Parent A search" : "Parent B search";
  return (
    <div className="slot" data-side={side}>
      <p className="slot-label">Parent {side.toUpperCase()}</p>
      {selected ? (
        <div className="slot-filled">
          <motion.img
            className="avatar"
            src={selected.image_url || "/assets/brand/mark-merge-o.svg"}
            alt={`${selected.name} avatar`}
            width={44}
            height={44}
            layoutId={reduceMotion ? undefined : `token-${selected.mint}`}
            transition={{ duration: 0.22, ease: [0.32, 0.72, 0, 1] }}
          />
          <div className="slot-filled-id">
            <strong>{selected.name}</strong>
            <span className="metric-label">${selected.symbol}</span>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClear}
            aria-label={`Clear parent ${side.toUpperCase()}`}
          >
            Clear
          </Button>
        </div>
      ) : (
        <>
          <label>
            <span className="sr-only">{label}</span>
            <input
              className="control"
              value={query}
              onChange={(event) => onQuery(event.target.value)}
              placeholder="Name, ticker or mint"
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          {results.length > 0 ? (
            <div className="slot-results" role="listbox" aria-label={label}>
              {results.slice(0, 8).map((token) => (
                <SearchResultButton key={token.mint} token={token} onSelect={onSelect} />
              ))}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
