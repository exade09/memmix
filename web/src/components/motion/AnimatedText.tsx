import { Fragment, type ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { staggerVariants, wordVariants } from "./motion";

/*
  A heading that arrives a word at a time.

  Each word gets its own clipping box and rises into it, so the line assembles
  instead of fading in as a block. The text stays real text: it is split on
  spaces and every word keeps its own element, so selection, search and screen
  readers are unaffected.
*/

function Words({ text, delay }: { text: string; delay: number }) {
  const words = text.split(" ").filter(Boolean);
  return (
    <motion.span
      className="anim-line"
      variants={staggerVariants(0.055, delay)}
      initial="initial"
      animate="animate"
    >
      {words.map((word, index) => (
        <Fragment key={`${word}-${index}`}>
          <span className="anim-word">
            <motion.span className="anim-word-inner" variants={wordVariants}>
              {word}
            </motion.span>
          </span>
          {index < words.length - 1 ? " " : null}
        </Fragment>
      ))}
    </motion.span>
  );
}

/**
 * @param lines each string becomes its own line, staggered after the one above
 * @param as     the element to render, so a hero can still be an h1
 */
export function AnimatedText({
  lines,
  as: Tag = "span",
  className,
  delay = 0,
  separator,
}: {
  lines: string[];
  as?: "h1" | "h2" | "p" | "span";
  className?: string;
  delay?: number;
  /** Rendered between lines; a <br /> for a headline that wraps deliberately. */
  separator?: ReactNode;
}) {
  const reduceMotion = useReducedMotion();

  if (reduceMotion) {
    return (
      <Tag className={className}>
        {lines.map((line, index) => (
          <Fragment key={line}>
            {index > 0 ? separator ?? " " : null}
            {line}
          </Fragment>
        ))}
      </Tag>
    );
  }

  return (
    <Tag className={className}>
      {lines.map((line, index) => (
        <Fragment key={line}>
          {index > 0 ? separator ?? " " : null}
          <Words text={line} delay={delay + index * 0.12} />
        </Fragment>
      ))}
    </Tag>
  );
}
