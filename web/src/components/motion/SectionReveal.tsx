import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";

type RevealTag = "section" | "div" | "footer";

export function SectionReveal({
  children,
  className,
  id,
  as = "section",
  ariaLabel,
}: {
  children: ReactNode;
  className?: string;
  id?: string;
  as?: RevealTag;
  ariaLabel?: string;
}) {
  const reduceMotion = useReducedMotion();

  if (reduceMotion) {
    const StaticTag = as;
    return (
      <StaticTag id={id} className={className} aria-label={ariaLabel}>
        {children}
      </StaticTag>
    );
  }

  const MotionTag = motion[as];
  return (
    <MotionTag
      id={id}
      className={className}
      aria-label={ariaLabel}
      /*
        Lift only, no fade. This wrapper sits around headings that animate
        themselves; fading the whole section at the same time washed the
        heading's own reveal out, which is why the landing page looked static
        while the app pages did not.
      */
      initial={{ y: 22 }}
      whileInView={{ y: 0 }}
      viewport={{ once: true, amount: 0.08, margin: "0px 0px -10% 0px" }}
      transition={{ duration: 0.6, ease: [0.32, 0.72, 0, 1] }}
    >
      {children}
    </MotionTag>
  );
}
