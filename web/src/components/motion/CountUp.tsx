import { useEffect, useRef, useState } from "react";
import { useInView, useReducedMotion } from "motion/react";
import { EASE } from "./motion";

/*
  A number that counts to its value when it is scrolled to.

  Only for figures that are genuinely quantities. The facts strip carries a
  mix — "2" and "0 ETH" are numbers, "None" is not — so anything this cannot
  parse is rendered untouched rather than mangled into a 0.
*/

const DURATION = 1100;

/** Splits "0 ETH" into 0 and " ETH" so the unit stays put while the digits move. */
function parse(value: string): { target: number; suffix: string; decimals: number } | null {
  const match = value.match(/^(-?\d+(?:\.\d+)?)(.*)$/);
  if (!match) return null;
  const [, digits, suffix] = match;
  return {
    target: Number(digits),
    suffix,
    decimals: digits.includes(".") ? digits.split(".")[1].length : 0,
  };
}

export function CountUp({ value, className }: { value: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.6 });
  const reduceMotion = useReducedMotion();
  const parsed = parse(value);
  const [shown, setShown] = useState(parsed ? 0 : null);

  useEffect(() => {
    if (!parsed || reduceMotion || !inView) return;
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min((now - start) / DURATION, 1);
      // The same curve the rest of the site moves on, so the digits settle
      // rather than stopping dead on the final value.
      const eased = 1 - Math.pow(1 - t, 3);
      setShown(parsed.target * eased);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inView, reduceMotion, value]);

  if (!parsed || reduceMotion) {
    return (
      <span ref={ref} className={className}>
        {value}
      </span>
    );
  }

  return (
    <span ref={ref} className={className} style={{ fontVariantNumeric: "tabular-nums" }}>
      {(shown ?? 0).toFixed(parsed.decimals)}
      {parsed.suffix}
    </span>
  );
}

export { EASE };
