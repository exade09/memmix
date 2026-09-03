import { Children, isValidElement, cloneElement, type ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { EASE } from "./motion";

/*
  A list whose items arrive in sequence as it scrolls into view.

  Like AnimatedText, every value is explicit rather than inherited through
  variants: the route transition wraps the app in <AnimatePresence
  initial={false}>, and anything relying on inherited variant state gets its
  first-load animation suppressed by that ancestor.

  Stagger passes each child its position so the delay can be computed locally.
*/

const MAX_DELAY = 0.5;

export function Stagger({
  children,
  className,
  step = 0.045,
  as = "div",
}: {
  children: ReactNode;
  className?: string;
  step?: number;
  as?: "div" | "ul" | "ol" | "section" | "nav";
}) {
  const Tag = as;
  const items = Children.toArray(children);
  return (
    <Tag className={className}>
      {items.map((child, index) =>
        isValidElement<{ index?: number; step?: number }>(child)
          ? cloneElement(child, { index, step })
          : child,
      )}
    </Tag>
  );
}

export function StaggerItem({
  children,
  className,
  as = "div",
  index = 0,
  step = 0.045,
}: {
  children: ReactNode;
  className?: string;
  as?: "div" | "li" | "article" | "aside" | "details";
  /** Injected by Stagger. */
  index?: number;
  step?: number;
}) {
  const reduceMotion = useReducedMotion();

  if (reduceMotion) {
    const Tag = as;
    return <Tag className={className}>{children}</Tag>;
  }

  const MotionTag = motion[as];
  // Capped, or the twentieth card in a long grid waits a full second while the
  // reader is already looking straight at it.
  const delay = Math.min(index * step, MAX_DELAY);

  return (
    <MotionTag
      className={className}
      initial={{ opacity: 0, y: 32, scale: 0.97, filter: "blur(6px)" }}
      whileInView={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
      viewport={{ once: true, amount: 0.15 }}
      transition={{ duration: 0.68, ease: EASE, delay }}
    >
      {children}
    </MotionTag>
  );
}
