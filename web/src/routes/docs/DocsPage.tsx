import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion, useScroll, useSpring } from "motion/react";
import { SiteFooter } from "../../components/layout/SiteFooter";
import { AnimatedText } from "../../components/motion/AnimatedText";
import { EASE } from "../../components/motion/motion";
import { ButtonLink } from "../../components/ui/Button";
import { DOC_META, DOC_SECTIONS, type DocBlock, type DocSection } from "./docsContent";

/*
  The documentation, built the way the rest of the site is built.

  Two things carry it: a reading-progress line across the top, and a contents
  rail that tracks where you are. Both exist because a long page with no sense
  of position is where documentation loses people, not because they are
  decorative.

  Everything animates on scroll through the same components the product uses,
  so this reads as part of Fons rather than as a manual bolted onto it.
*/

function useActiveSection(ids: string[]): string {
  const [active, setActive] = useState(ids[0] ?? "");

  useEffect(() => {
    const targets = ids
      .map((id) => document.getElementById(id))
      .filter((node): node is HTMLElement => Boolean(node));
    if (!targets.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        // The heading nearest the top of the viewport wins, so the rail does
        // not flicker between two sections that are both partly visible.
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]?.target.id) setActive(visible[0].target.id);
      },
      { rootMargin: "-12% 0px -70% 0px", threshold: [0, 1] },
    );

    targets.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [ids]);

  return active;
}

function Block({ block, index }: { block: DocBlock; index: number }) {
  const reduceMotion = useReducedMotion();
  const rise = reduceMotion
    ? {}
    : {
        initial: { opacity: 0, y: 14 },
        whileInView: { opacity: 1, y: 0 },
        viewport: { once: true, amount: 0.2 },
        transition: { duration: 0.5, ease: EASE, delay: Math.min(index * 0.06, 0.3) },
      };

  if (block.kind === "text") {
    return (
      <motion.p className="body-copy" {...rise}>
        {block.body}
      </motion.p>
    );
  }

  if (block.kind === "note") {
    return (
      <motion.aside className="doc-note" {...rise}>
        {block.body}
      </motion.aside>
    );
  }

  if (block.kind === "list") {
    return (
      <motion.ul className="doc-list" {...rise}>
        {block.items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </motion.ul>
    );
  }

  if (block.kind === "facts") {
    return (
      <motion.dl className="doc-facts" {...rise}>
        {block.items.map(([term, value]) => (
          <div key={term}>
            <dt>{term}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </motion.dl>
    );
  }

  return (
    <motion.ol className="doc-steps" {...rise}>
      {block.items.map(([title, body], step) => (
        <li key={title}>
          <span className="doc-step-index">{String(step + 1).padStart(2, "0")}</span>
          <div>
            <strong>{title}</strong>
            <p>{body}</p>
          </div>
        </li>
      ))}
    </motion.ol>
  );
}

function Section({ section }: { section: DocSection }) {
  return (
    <section className="doc-section" id={section.id} aria-labelledby={`${section.id}-title`}>
      <div className="doc-section-head">
        <AnimatedText as="h2" reveal="lines" lines={[section.title]} className="doc-title" />
        <AnimatedText reveal="fade" delay={0.12} lines={[section.lede]} className="doc-lede" />
      </div>
      <div className="doc-blocks">
        {section.blocks.map((block, index) => (
          <Block key={`${section.id}-${index}`} block={block} index={index} />
        ))}
      </div>
    </section>
  );
}

export function DocsPage() {
  const ids = DOC_SECTIONS.map((section) => section.id);
  const active = useActiveSection(ids);
  const reduceMotion = useReducedMotion();
  const body = useRef<HTMLDivElement>(null);

  const { scrollYProgress } = useScroll({ target: body, offset: ["start start", "end end"] });
  const progress = useSpring(scrollYProgress, { stiffness: 120, damping: 30, mass: 0.4 });

  return (
    <>
      {reduceMotion ? null : (
        <motion.div className="doc-progress" style={{ scaleX: progress }} aria-hidden="true" />
      )}

      <div className="section doc-hero">
        <div className="wrap">
          <p className="eyebrow">{DOC_META.eyebrow}</p>
          <AnimatedText as="h1" lines={DOC_META.title} />
          <AnimatedText reveal="fade" delay={0.4} lines={[DOC_META.lede]} className="lede" />
        </div>
      </div>

      <div className="wrap doc-layout" ref={body}>
        <nav className="doc-rail" aria-label="Contents">
          <p className="metric-label">Contents</p>
          <ul>
            {DOC_SECTIONS.map((section) => (
              <li key={section.id}>
                <a href={`#${section.id}`} className={active === section.id ? "is-active" : ""}>
                  {active === section.id && !reduceMotion ? (
                    <motion.span layoutId="doc-marker" className="doc-marker" aria-hidden="true" />
                  ) : null}
                  {section.title}
                </a>
              </li>
            ))}
          </ul>
          <ButtonLink to="/app/mix" variant="primary" size="sm" arrow>
            Open the lab
          </ButtonLink>
        </nav>

        <div className="doc-body">
          {DOC_SECTIONS.map((section) => (
            <Section key={section.id} section={section} />
          ))}

          <aside className="doc-end">
            <AnimatedText as="h2" reveal="lines" lines={["Two tokens in, one born"]} />
            <p className="body-copy">
              That is the whole product. Everything above is the detail underneath it.
            </p>
            <div className="btn-row">
              <ButtonLink to="/app/mix" variant="primary" arrow>
                Mix two tokens
              </ButtonLink>
              <ButtonLink to="/app/launch" variant="outline">
                Launch without AI
              </ButtonLink>
            </div>
          </aside>
        </div>
      </div>

      <SiteFooter />
    </>
  );
}
