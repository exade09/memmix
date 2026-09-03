import { Fragment, type ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { EASE } from "./motion";

/*
  Text that arrives instead of appearing.

  Three treatments, because one repeated everywhere is what makes a page feel
  mechanical:

    "words"  each word rises into its own clipped box. The strongest of the
             three, kept for the hero and for section headings.
    "lines"  the whole line is wiped upward behind a mask. Quieter and faster,
             for headings that sit inside the app window where a per-word
             stagger would be fussy next to a form.
    "fade"   a plain lift, for body copy that should follow its heading rather
             than compete with it.

  Two things are deliberate and should not be "tidied" away:

  1. Every value is passed explicitly rather than through variants. The route
     transition wraps each page in <AnimatePresence initial={false}>, and that
     suppresses the first-load animation of any descendant that inherits its
     state. Explicit props cannot be overridden by an ancestor.

  2. Viewport reveal is the default, with a low threshold. A heading above the fold
     is already in view and plays on load; one further down waits to be
     scrolled to. The words start at opacity 0, so a viewport rule that never
     fires would leave a heading permanently invisible — 10% of any part
     entering is a threshold a large heading on a short screen can still meet.
     The landing hero opts into an explicit active gate so it begins only
     after the intro exits, then stays complete while the visitor scrolls.
*/

export type TextReveal = "words" | "lines" | "fade";

const WORD_STEP = 0.085;
const LINE_STEP = 0.18;

/** Slow enough to be seen. The previous 0.5s read as a flicker on load. */
const DURATION = { words: 0.82, lines: 0.86, fade: 0.72 } as const;

const viewport = { once: true, amount: 0.1, margin: "0px 0px -6% 0px" } as const;

const WORD_HIDDEN = {
  opacity: 0,
  y: "0.96em",
  rotate: 1.6,
  scale: 0.975,
  filter: "blur(8px)",
} as const;
const WORD_VISIBLE = {
  opacity: 1,
  y: "0em",
  rotate: 0,
  scale: 1,
  filter: "blur(0px)",
} as const;
const LINE_HIDDEN = { opacity: 0, y: "0.76em", filter: "blur(6px)" } as const;
const LINE_VISIBLE = { opacity: 1, y: "0em", filter: "blur(0px)" } as const;

function Word({ word, delay, active }: { word: string; delay: number; active?: boolean }) {
  return (
    <span className="anim-word">
      <motion.span
        className="anim-word-inner"
        initial={WORD_HIDDEN}
        animate={active === undefined ? undefined : active ? WORD_VISIBLE : WORD_HIDDEN}
        whileInView={active === undefined ? WORD_VISIBLE : undefined}
        viewport={active === undefined ? viewport : undefined}
        transition={{ duration: DURATION.words, ease: EASE, delay }}
      >
        {word}
      </motion.span>
    </span>
  );
}

function Line({ line, delay, active }: { line: string; delay: number; active?: boolean }) {
  const words = line.split(" ").filter(Boolean);

  return (
    <>
      {words.map((word, index) => (
        <Fragment key={`${word}-${index}`}>
          <span className="anim-word">
            <motion.span
              className="anim-word-inner"
              initial={LINE_HIDDEN}
              animate={active === undefined ? undefined : active ? LINE_VISIBLE : LINE_HIDDEN}
              whileInView={active === undefined ? LINE_VISIBLE : undefined}
              viewport={active === undefined ? viewport : undefined}
              transition={{ duration: DURATION.lines, ease: EASE, delay }}
            >
              {word}
            </motion.span>
          </span>
          {index < words.length - 1 ? " " : null}
        </Fragment>
      ))}
    </>
  );
}

export function AnimatedText({
  lines,
  as: Tag = "span",
  className,
  delay = 0,
  separator,
  reveal = "words",
  active,
}: {
  lines: string[];
  as?: "h1" | "h2" | "h3" | "p" | "span";
  className?: string;
  delay?: number;
  separator?: ReactNode;
  reveal?: TextReveal;
  /** Control a reveal explicitly. Omit to keep the normal one-shot viewport behavior. */
  active?: boolean;
}) {
  const reduceMotion = useReducedMotion();

  if (reduceMotion) {
    return (
      <Tag className={className}>
        {lines.map((line, index) => (
          <Fragment key={`${line}-${index}`}>
            {index > 0 ? separator ?? " " : null}
            {line}
          </Fragment>
        ))}
      </Tag>
    );
  }

  if (reveal === "fade") {
    return (
      <motion.p
        className={className}
        initial={{ opacity: 0, y: 22, filter: "blur(5px)" }}
        animate={
          active === undefined
            ? undefined
            : active
              ? { opacity: 1, y: 0, filter: "blur(0px)" }
              : { opacity: 0, y: 22, filter: "blur(5px)" }
        }
        whileInView={active === undefined ? { opacity: 1, y: 0, filter: "blur(0px)" } : undefined}
        viewport={active === undefined ? viewport : undefined}
        transition={{ duration: DURATION.fade, ease: EASE, delay }}
      >
        {lines.map((line, index) => (
          <Fragment key={`${line}-${index}`}>
            {index > 0 ? separator ?? " " : null}
            {line}
          </Fragment>
        ))}
      </motion.p>
    );
  }

  if (reveal === "lines") {
    return (
      <Tag className={className}>
        {lines.map((line, index) => (
          <Fragment key={`${line}-${index}`}>
            {index > 0 ? separator ?? " " : null}
            <Line line={line} delay={delay + index * LINE_STEP} active={active} />
          </Fragment>
        ))}
      </Tag>
    );
  }

  // A running count so the stagger continues across a line break rather than
  // restarting, which would read as two separate animations.
  let wordIndex = 0;

  return (
    <Tag className={className}>
      {lines.map((line, lineIndex) => {
        const words = line.split(" ").filter(Boolean);
        return (
          <Fragment key={`${line}-${lineIndex}`}>
            {lineIndex > 0 ? separator ?? " " : null}
            <span className="anim-line">
              {words.map((word, index) => {
                const wordDelay = delay + wordIndex * WORD_STEP + lineIndex * LINE_STEP;
                wordIndex += 1;
                return (
                  <Fragment key={`${word}-${index}`}>
                    <Word word={word} delay={wordDelay} active={active} />
                    {index < words.length - 1 ? " " : null}
                  </Fragment>
                );
              })}
            </span>
          </Fragment>
        );
      })}
    </Tag>
  );
}
