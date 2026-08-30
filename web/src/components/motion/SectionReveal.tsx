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
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.16, margin: "0px" }}
      transition={{ duration: 0.22, ease: "easeOut" }}
    >
      {children}
    </MotionTag>
  );
}
