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

  2. whileInView, not animate, with a low threshold. A heading above the fold
     is already in view and plays on load; one further down waits to be
     scrolled to. The words start at opacity 0, so a viewport rule that never
     fires would leave a heading permanently invisible — 10% of any part
     entering is a threshold a large heading on a short screen can still meet.
*/

export type TextReveal = "words" | "lines" | "fade";

const WORD_STEP = 0.06;
const LINE_STEP = 0.14;

/** Slow enough to be seen. The previous 0.5s read as a flicker on load. */
const DURATION = { words: 0.66, lines: 0.72, fade: 0.6 } as const;

const viewport = { once: true, amount: 0.1, margin: "0px 0px -6% 0px" } as const;

function Word({ word, delay }: { word: string; delay: number }) {
  return (
    <span className="anim-word">
      <motion.span
        className="anim-word-inner"
        initial={{ opacity: 0, y: "0.78em", rotate: 1.4 }}
        whileInView={{ opacity: 1, y: "0em", rotate: 0 }}
        viewport={viewport}
        transition={{ duration: DURATION.words, ease: EASE, delay }}
      >
        {word}
      </motion.span>
    </span>
  );
}

function Line({ line, delay }: { line: string; delay: number }) {
  return (
    <span className="anim-word">
      <motion.span
        className="anim-word-inner"
        initial={{ opacity: 0, y: "0.6em" }}
        whileInView={{ opacity: 1, y: "0em" }}
        viewport={viewport}
        transition={{ duration: DURATION.lines, ease: EASE, delay }}
      >
        {line}
      </motion.span>
    </span>
  );
}

export function AnimatedText({
  lines,
  as: Tag = "span",
  className,
  delay = 0,
  separator,
  reveal = "words",
}: {
  lines: string[];
  as?: "h1" | "h2" | "h3" | "p" | "span";
  className?: string;
  delay?: number;
  separator?: ReactNode;
  reveal?: TextReveal;
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
        initial={{ opacity: 0, y: 14 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={viewport}
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
            <Line line={line} delay={delay + index * LINE_STEP} />
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
                    <Word word={word} delay={wordDelay} />
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
