import { Fragment, type ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { EASE } from "./motion";

/*
  A heading that assembles a word at a time.

  Each word rises inside its own clipping box, so the line builds itself
  instead of fading in as a block. The text stays real text: it is split on
  spaces and every word keeps its own element, so selection, find-in-page and
  screen readers are unaffected.

  Two deliberate choices here, both learned the hard way:

  1. Every value is passed explicitly rather than through variants. Variants
     inherit their state from the nearest motion parent, and the route
     transition wraps the whole page in <AnimatePresence initial={false}>,
     which suppressed the first-load animation of everything inside it. That
     is exactly why the hero sat still. Explicit props cannot be overridden by
     an ancestor.

  2. whileInView rather than animate. A heading above the fold is already in
     view, so it plays on load; one further down waits until it is scrolled
     to. `once` keeps it from replaying on the way back up.
*/

const WORD_STEP = 0.055;
const LINE_STEP = 0.12;

function Word({ word, delay }: { word: string; delay: number }) {
  return (
    <span className="anim-word">
      <motion.span
        className="anim-word-inner"
        initial={{ opacity: 0, y: "0.5em" }}
        whileInView={{ opacity: 1, y: "0em" }}
        viewport={{ once: true, amount: 0.4 }}
        transition={{ duration: 0.5, ease: EASE, delay }}
      >
        {word}
      </motion.span>
    </span>
  );
}

/**
 * @param lines     each string becomes its own line, staggered after the one above
 * @param as        the element to render, so a hero can still be an h1
 * @param separator rendered between lines; a <br /> for a headline that wraps
 */
export function AnimatedText({
  lines,
  as: Tag = "span",
  className,
  delay = 0,
  separator,
}: {
  lines: string[];
  as?: "h1" | "h2" | "h3" | "p" | "span";
  className?: string;
  delay?: number;
  separator?: ReactNode;
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

  // A running count so the stagger continues across line breaks rather than
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
