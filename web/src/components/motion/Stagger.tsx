import type { ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { inView, itemVariants, staggerVariants } from "./motion";

/*
  A list whose items arrive in sequence as it scrolls into view.

  Used for the token feed and any other grid. Without it a grid of twenty cards
  appears in a single frame, which reads as a page load rather than as content.
*/

export function Stagger({
  children,
  className,
  step = 0.045,
  as = "div",
}: {
  children: ReactNode;
  className?: string;
  step?: number;
  as?: "div" | "ul" | "section";
}) {
  const reduceMotion = useReducedMotion();
  if (reduceMotion) {
    const Tag = as;
    return <Tag className={className}>{children}</Tag>;
  }
  const MotionTag = motion[as];
  return (
    <MotionTag className={className} variants={staggerVariants(step)} {...inView}>
      {children}
    </MotionTag>
  );
}

export function StaggerItem({
  children,
  className,
  as = "div",
}: {
  children: ReactNode;
  className?: string;
  as?: "div" | "li";
}) {
  const reduceMotion = useReducedMotion();
  if (reduceMotion) {
    const Tag = as;
    return <Tag className={className}>{children}</Tag>;
  }
  const MotionTag = motion[as];
  return (
    <MotionTag className={className} variants={itemVariants}>
      {children}
    </MotionTag>
  );
}
