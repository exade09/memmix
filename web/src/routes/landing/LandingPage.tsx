import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { LayoutGroup, motion, useReducedMotion } from "motion/react";
import { isTokenAddress } from "../../chain/address";
import { appConfig, networkLabel } from "../../app/config";
import { GlassMark, type GlassState } from "../../components/brand/GlassMark";
import { SiteFooter } from "../../components/layout/SiteFooter";
import { SectionReveal } from "../../components/motion/SectionReveal";
import { AnimatedText } from "../../components/motion/AnimatedText";
import { CountUp } from "../../components/motion/CountUp";
import { Stagger, StaggerItem } from "../../components/motion/Stagger";
import { EASE } from "../../components/motion/motion";
import { SearchResultButton, TokenFeedCard, TokenSkeleton, toParent } from "../../components/token/TokenFeedCard";
import { Button, ButtonLink } from "../../components/ui/Button";
import { FAQ_ITEMS, SAFETY_PILLARS } from "../../domain/legalCopy";
import { readDraftMix, setDraftParent, type ParentToken } from "../../domain/draft";
import { track } from "../../services/analytics";
import { fetchFeedResult, searchTokensResult, type TokenSummary } from "../../services/api";
import { TokenAvatar } from "../../components/token/TokenAvatar";

const HOW = [
  ["01", "Pick", "Any two Robinhood Chain tokens"],
  ["02", "Mutate", "AI finds the logic, not a word splice"],
  ["03", "Edit", "Every field stays yours"],
  ["04", "Launch", "See the debit, then sign it"],
] as const;

/*
  Facts, not vanity counters. Every number here is something the app can
  actually stand behind.
*/
const FACTS = [
  ["Tokens in", "2", "Never one"],
  ["AI outputs", "4", "Name, ticker, description, avatar"],
  ["Platform fee", "0 ETH", "Gas still costs ETH"],
] as const;

const SAFETY_INDEXED = SAFETY_PILLARS.map(([title, copy], index) => [
  String(index + 1).padStart(2, "0"),
  title,
  copy,
] as const);



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
  const [feedTab, setFeedTab] = useState<"trending" | "new" | "graduated" | "mixable">("trending");
  const abortA = useRef<AbortController | null>(null);
  const abortB = useRef<AbortController | null>(null);
  const timerA = useRef(0);
  const timerB = useRef(0);

  useEffect(() => {
    const draft = readDraftMix();
    setParentA(draft.parent_a);
    setParentB(draft.parent_b);
  }, []);

  const mascotState = useMemo<GlassState>(() => {
    if (duplicateError) return "warning";
    if (parentA && parentB) return "ready";
    if (parentA || parentB || queryA || queryB) return "searching";
    return "idle";
  }, [parentA, parentB, queryA, queryB, duplicateError]);

  useEffect(() => {
    let cancelled = false;
    setFeedLoading(true);
    fetchFeedResult({ tab: feedTab, limit: 24 })
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
    if (query.length < 2 && !isTokenAddress(query)) {
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
      setSearchError("The scanner is offline. Try a contract address or retry.");
    }
  }

  function selectParent(side: "a" | "b", token: TokenSummary) {
    if (!token.mint) return;
    const other = side === "a" ? parentB : parentA;
    if (other && other.mint === token.mint) {
      setDuplicateError("The two tokens must be different.");
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
        {/*
          The launcher is the hero. Two parent slots and the operator are the
          first thing on the page, so a visitor can start a mutation without
          scrolling or reading anything first.
        */}
        <section className="hero">
          <div className="wrap hero-inner">
            <div className="hero-copy">
              <motion.p
                className="eyebrow"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, ease: EASE }}
              >
                Launchpad · {networkLabel()}
              </motion.p>
              <h1 className="hero-title">
                <AnimatedText lines={["Two tokens in"]} delay={0.05} />
                <br />
                <span className="hero-born">
                  <AnimatedText lines={["One born"]} delay={0.24} />
                </span>
              </h1>
              <AnimatedText
                className="lede"
                reveal="fade"
                delay={0.78}
                lines={["Pick two tokens. Get one new character. Launch it on Robinhood Chain"]}
              />
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
              mascotState={mascotState}
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

          {/* fact strip */}
          <div className="wrap">
            <dl className="fact-strip" style={{ "--fact-count": FACTS.length } as CSSProperties}>
              {FACTS.map(([label, value, note], index) => (
                <motion.div
                  key={label}
                  initial={{ opacity: 0, y: 16 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, amount: 0.4 }}
                  transition={{ duration: 0.5, ease: EASE, delay: index * 0.08 }}
                >
                  <dt>{label}</dt>
                  <dd>
                    <CountUp value={value} />
                  </dd>
                  <p>{note}</p>
                </motion.div>
              ))}
            </dl>
          </div>
        </section>

        {/* --------------------------------------------------------- how it works */}
        <SectionReveal className="section raised" ariaLabel="Process">
          <div className="wrap">
            <div className="panel-head">
              <div>
                <p className="eyebrow">Process</p>
                <AnimatedText as="h2" lines={["From two memes to one mint"]} />
              </div>
              <p className="body-copy">The lab does not predict the market. It makes new things for it</p>
            </div>
            <Stagger as="ol" className="step-grid" step={0.08}>
              {HOW.map(([index, title, copy]) => (
                <StaggerItem key={title} as="li" className="step-card">
                  <span className="step-index">{index}</span>
                  <h3>{title}</h3>
                  <p>{copy}</p>
                </StaggerItem>
              ))}
            </Stagger>
          </div>
        </SectionReveal>

        {/* --------------------------------------------------------- two paths */}
        <SectionReveal className="section" ariaLabel="Two paths">
          <div className="wrap">
            <Stagger className="path-grid" step={0.12}>
              <StaggerItem as="article" className="path-card is-a">
                <p className="eyebrow">AI Mix</p>
                <h2>I have two tokens. Make the third</h2>
<p className="body-copy">Two tokens in, one editable character out</p>
                <ButtonLink to="/app/mix" variant="primary" arrow onClick={() => track("landing_primary_cta")}>
                  Open the mixer
                </ButtonLink>
              </StaggerItem>
              <StaggerItem as="article" className="path-card is-b">
                <p className="eyebrow">Direct Launch</p>
                <h2>I already know what I am launching</h2>
<p className="body-copy">Name, ticker, image, links. Works with AI offline</p>
                <ButtonLink to="/app/launch" variant="outline" arrow onClick={() => track("landing_direct_launch_cta")}>
                  Open the launchpad
                </ButtonLink>
              </StaggerItem>
            </Stagger>
          </div>
        </SectionReveal>

        {/* --------------------------------------------------------- live feed */}
        <SectionReveal className="section raised" ariaLabel="Live scan">
          <div className="wrap">
            <div className="panel-head">
              <div>
                <p className="eyebrow">Live scan</p>
                <AnimatedText as="h2" lines={["Pick something alive"]} />
              </div>
              <div className="btn-row">
                <div className="segmented" role="group" aria-label="Feed filter">
                  {(["trending", "new", "graduated", "mixable"] as const).map((tab) => (
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
              {feedCached ? <span className="chip warn">Cached examples, not live market data</span> : null}
            </div>
            {feedError ? (
              <p className="note error" role="status">
                {feedError} Retry the scanner or paste a token address.
              </p>
            ) : null}
            {!feedLoading && !feedError && feed.length === 0 ? (
              <p className="empty-state">Nothing matched those filters. Loosen them a little.</p>
            ) : null}
            <Stagger className="feed-grid">
              {feedLoading
                ? Array.from({ length: 8 }, (_, index) => <TokenSkeleton key={index} />)
                : feed.map((token) => (
                    <StaggerItem key={token.mint}>
                      <TokenFeedCard
                        token={token}
                        assignedSide={assignedSide(token)}
                        onAssign={selectParent}
                      />
                    </StaggerItem>
                  ))}
            </Stagger>
          </div>
        </SectionReveal>

        {/* --------------------------------------------------------- the mark */}
        <SectionReveal id="mascot" className="section born-section" ariaLabel="What is born">
          <div className="wrap born-section-inner">
            <div className="born-section-figure">
              <GlassMark state="idle" className="sz-lg" />
            </div>
            <div className="stack">
              <p className="eyebrow">What is born</p>
              <AnimatedText as="h2" lines={["Two rings of glass, and the bead between them"]} />
              <p className="body-copy">
                One parent arrives warm, one arrives cold. Where they overlap, something clear forms that was in
                neither of them. That is the whole product, and it is the whole mark
              </p>
              <p className="body-copy">The rings hold. They never hold your keys</p>
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
                <AnimatedText as="h2" lines={["Safe to sign. Never safe to assume"]} />
              </div>
            </div>
            <div className="safety-layout">
              <Stagger as="ol" className="pillar-grid" step={0.07}>
                {SAFETY_INDEXED.map(([index, title, copy]) => (
                  <StaggerItem key={title} as="li" className="pillar-card">
                    <span className="step-index">{index}</span>
                    <h3>{title}</h3>
                    <p>{copy}</p>
                  </StaggerItem>
                ))}
              </Stagger>
            </div>
          </div>
        </SectionReveal>

        {/* --------------------------------------------------------- faq */}
        <SectionReveal className="section" ariaLabel="FAQ">
          <div className="wrap faq-layout">
            <div className="stack sm faq-head">
              <p className="eyebrow">FAQ</p>
              <AnimatedText as="h2" lines={["Before you sign"]} />
<p className="body-copy">What {appConfig.productName} can and cannot do</p>
            </div>
            <Stagger className="faq-list" step={0.055}>
              {FAQ_ITEMS.map(([question, answer], index) => (
                <StaggerItem key={question} as="details" className="disclosure faq-item">
                  <summary>
                    <span className="faq-index">{String(index + 1).padStart(2, "0")}</span>
                    {question}
                  </summary>
                  <div className="disclosure-body">
                    <p className="body-copy">{answer}</p>
                  </div>
                </StaggerItem>
              ))}
            </Stagger>
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
  mascotState,
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
  mascotState: GlassState;
  reduceMotion: boolean;
  onQueryA: (value: string) => void;
  onQueryB: (value: string) => void;
  onSelect: (side: "a" | "b", token: TokenSummary) => void;
  onClear: (side: "a" | "b") => void;
}) {
  const ready = Boolean(parentA && parentB);
  return (
    <motion.div
      className="panel flush bench"
      aria-label="Mix bench"
      initial={reduceMotion ? false : { opacity: 0, y: 26, scale: 0.985, filter: "blur(5px)" }}
      animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
      transition={{ duration: reduceMotion ? 0 : 0.72, ease: EASE, delay: reduceMotion ? 0 : 0.32 }}
    >
      <div className="chrome-bar">
        <span>
          <span className="chrome-lights" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          FONS · MIX
        </span>
        <span className="chrome-glyphs" aria-hidden="true">
          <i>&minus;</i>
          <i>&#9723;</i>
          <i>&times;</i>
        </span>
      </div>
      <div className="bench-body">
        <div className="bench-row">
          <ParentSearch
            side="a"
            query={queryA}
            selected={parentA}
            results={resultsA}
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
            onQuery={onQueryB}
            onSelect={(token) => onSelect("b", token)}
            onClear={() => onClear("b")}
          />
          <span className="bench-op" aria-hidden="true">
            →
          </span>
          {/*
            The operator is the output slot. His face already renders the
            merge, so he does the job a separate result box used to do and
            takes up less of the page doing it.
          */}
          <div className="bench-out">
<GlassMark state={mascotState} className="sz-sm" />
          </div>
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

        <div className="bench-actions">
          {ready ? (
            <motion.div
              initial={reduceMotion ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: reduceMotion ? 0.12 : 0.22 }}
            >
              <ButtonLink to="/app/mix" variant="primary" size="lg" arrow>
                Start mutation
              </ButtonLink>
            </motion.div>
          ) : (
            <ButtonLink to="/app/mix" variant="primary" size="lg" arrow onClick={() => track("landing_primary_cta")}>
              Open the mixer
            </ButtonLink>
          )}
          <ButtonLink
            to="/app/launch"
            variant="outline"
            size="lg"
            onClick={() => track("landing_direct_launch_cta")}
          >
            Launch without AI
          </ButtonLink>
        </div>
      </div>
    </motion.div>
  );
}

function ParentSearch({
  side,
  query,
  selected,
  results,
  onQuery,
  onSelect,
  onClear,
}: {
  side: "a" | "b";
  query: string;
  selected: ParentToken | null;
  results: TokenSummary[];
  onQuery: (value: string) => void;
  onSelect: (token: TokenSummary) => void;
  onClear: () => void;
}) {
  const label = side === "a" ? "Token A search" : "Token B search";
  return (
    <div className="slot" data-side={side}>
      <p className="slot-label">Token {side.toUpperCase()}</p>
      {selected ? (
        <div className="slot-filled">
          <TokenAvatar
            src={selected.image_url}
            symbol={selected.symbol}
            name={selected.name}
            seed={selected.mint}
            size={44}
            layoutId={`token-${selected.mint}`}
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
              placeholder="Name, ticker or address"
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
