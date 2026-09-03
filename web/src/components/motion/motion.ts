import type { Transition, Variants } from "motion/react";

/*
  One place for how this site moves.

  The design is calm: mist, glass, still water. Motion has to match that or it
  fights the thing it is decorating. So everything here is short, soft and
  slightly slow to settle, and nothing overshoots or bounces.

  Every component that uses these still checks useReducedMotion and renders a
  static element instead. These constants are the shape of the movement, not
  permission to move.
*/

/** The site's easing. A quick departure and a long, quiet arrival. */
export const EASE = [0.32, 0.72, 0, 1] as const;

export const DURATION = {
  /** Hovers and presses. Must feel instant. */
  tap: 0.14,
  /** The default for anything entering or leaving. */
  base: 0.28,
  /** Page-level changes, where a beat of weight reads as deliberate. */
  page: 0.36,
} as const;

export const transition: Transition = { duration: DURATION.base, ease: EASE };
export const pageTransition: Transition = { duration: DURATION.page, ease: EASE };

/** Enter from slightly below, leave straight up. Used for route changes. */
export const pageVariants: Variants = {
  initial: { opacity: 0, y: 14, scale: 0.997, filter: "blur(3px)" },
  animate: { opacity: 1, y: 0, scale: 1, filter: "blur(0px)", transition: pageTransition },
  exit: { opacity: 0, y: -8, scale: 0.998, filter: "blur(2px)", transition: { duration: 0.18, ease: EASE } },
};

/**
 * A container whose children arrive one after another.
 *
 * The delay is small on purpose: a long stagger across a grid of twenty cards
 * turns into a wave the eye has to wait out.
 */
export function staggerVariants(step = 0.045, initialDelay = 0): Variants {
  return {
    initial: {},
    animate: { transition: { staggerChildren: step, delayChildren: initialDelay } },
  };
}

export const itemVariants: Variants = {
  initial: { opacity: 0, y: 16, scale: 0.99, filter: "blur(3px)" },
  animate: { opacity: 1, y: 0, scale: 1, filter: "blur(0px)", transition },
};

/** For words in a headline: they rise into place rather than fading in flat. */
export const wordVariants: Variants = {
  initial: { opacity: 0, y: "0.42em" },
  animate: { opacity: 1, y: "0em", transition: { duration: 0.44, ease: EASE } },
};

/** Shared press feedback, so every control in the app answers the same way. */
export const press = {
  whileHover: { y: -1 },
  whileTap: { y: 0, scale: 0.985 },
  transition: { duration: DURATION.tap, ease: EASE },
} as const;

/** Reveal on scroll. `once` so a long page does not re-animate on the way back. */
export const inView = {
  initial: "initial",
  whileInView: "animate",
  viewport: { once: true, amount: 0.16 },
} as const;
