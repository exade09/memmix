import { useEffect, useId, useRef, useState } from "react";
import { motion, useInView, useReducedMotion } from "motion/react";

/*
  The glass mark.

  Two rings of glass, one warm and one cool, overlapping the way the two
  parent tokens do. What is born appears as a clear bead at their
  intersection. It is the same idea the wordmark carries -- MIXB[O]RN, the
  O born from two parents -- rendered as an object rather than a character,
  which is what the FONS visual language is made of.

  It replaces the hooded mascot in the interface. That drawing still lives
  in BornMascot.tsx and can come back the moment there is a glass version
  of him to load.
*/

export type GlassState =
  | "idle"
  | "searching"
  | "ready"
  | "mixing"
  | "generating"
  | "success"
  | "warning"
  | "wallet"
  | "launched";

const ALT: Record<GlassState, string> = {
  idle: "Two empty glass rings, waiting for parent tokens",
  searching: "One parent token held in a warm glass ring",
  ready: "Two parent tokens held in overlapping glass rings",
  mixing: "The two glass rings turning as the parents mix",
  generating: "The rings turning while the avatar is drawn",
  success: "A clear glass bead at the centre: the token that was born",
  warning: "The glass rings holding, with a problem flagged",
  wallet: "The glass rings waiting for a wallet signature",
  launched: "A clear glass bead, confirmed on-chain",
};

function ringsFor(state: GlassState) {
  switch (state) {
    case "searching":
      return { a: true, b: false, bead: false, spin: false };
    case "ready":
      return { a: true, b: true, bead: false, spin: false };
    case "mixing":
    case "generating":
      return { a: true, b: true, bead: false, spin: true };
    case "success":
    case "launched":
      return { a: true, b: true, bead: true, spin: false };
    case "wallet":
    case "warning":
      return { a: true, b: true, bead: false, spin: false };
    default:
      return { a: false, b: false, bead: false, spin: false };
  }
}

const MARK_SRC = "/assets/brand/fons-mark.webp";

type ArtStatus = "loading" | "ok" | "failed";
/** Load outcome, remembered so a second mark on the page never re-runs the swap. */
let artStatus: ArtStatus = "loading";

export function GlassMark({
  state = "idle",
  className = "",
  caption,
  quiet = false,
}: {
  state?: GlassState;
  className?: string;
  caption?: string;
  /** Suppress the ambient drift even when the mark is on screen. */
  quiet?: boolean;
}) {
  const raw = useId();
  const id = raw.replace(/[^a-zA-Z0-9-]/g, "");
  const reduceMotion = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { amount: 0.2 });
  const [pageVisible, setPageVisible] = useState(
    () => typeof document === "undefined" || !document.hidden,
  );

  useEffect(() => {
    const sync = () => setPageVisible(!document.hidden);
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, []);

  // Looping motion stops off-viewport, in a hidden tab and under reduced motion.
  const animate = Boolean(!reduceMotion && inView && pageVisible && !quiet);
  const rings = ringsFor(state);
  const [art, setArt] = useState<ArtStatus>(artStatus);
  /*
    The rendered logo is the real mark; the drawn rings below are the
    fallback for when it cannot be fetched. Showing the drawing while the
    image is still in flight would flash a different mark, so it only
    appears once the image has actually failed.
  */
  const showDrawn = art === "failed";

  return (
    <div
      ref={ref}
      className={`glass-mark ${className}`.trim()}
      data-state={state}
      data-offscreen={inView ? "false" : "true"}
    >
      <motion.div
        className="glass-mark-body"
        animate={animate ? { y: [0, -6, 0] } : { y: 0 }}
        transition={animate ? { duration: 7, repeat: Infinity, ease: "easeInOut" } : { duration: 0.2 }}
      >
        <img
          className={`glass-mark-art${art === "ok" ? " is-on" : ""}`}
          src={MARK_SRC}
          alt={ALT[state]}
          decoding="async"
          onLoad={(event) => {
            const ok = event.currentTarget.naturalWidth > 8;
            artStatus = ok ? "ok" : "failed";
            setArt(artStatus);
          }}
          onError={() => {
            artStatus = "failed";
            setArt(artStatus);
          }}
        />
        <svg
          viewBox="0 0 200 200"
          className="glass-mark-drawn"
          role={showDrawn ? "img" : "presentation"}
          aria-label={showDrawn ? ALT[state] : undefined}
          aria-hidden={showDrawn ? undefined : true}
          style={showDrawn ? undefined : { display: "none" }}
        >
          <defs>
            <radialGradient id={`${id}-warm`} cx="34%" cy="28%" r="78%">
              <stop offset="0%" stopColor="#ffffff" stopOpacity="0.95" />
              <stop offset="42%" stopColor="#f0dcb6" stopOpacity="0.7" />
              <stop offset="100%" stopColor="#c99a4f" stopOpacity="0.55" />
            </radialGradient>
            <radialGradient id={`${id}-cool`} cx="66%" cy="28%" r="78%">
              <stop offset="0%" stopColor="#ffffff" stopOpacity="0.95" />
              <stop offset="42%" stopColor="#cfe2ea" stopOpacity="0.7" />
              <stop offset="100%" stopColor="#7ba3b6" stopOpacity="0.55" />
            </radialGradient>
            <radialGradient id={`${id}-clear`} cx="38%" cy="26%" r="80%">
              <stop offset="0%" stopColor="#ffffff" />
              <stop offset="45%" stopColor="#e8f1e2" stopOpacity="0.92" />
              <stop offset="100%" stopColor="#a9c69a" stopOpacity="0.72" />
            </radialGradient>
            <linearGradient id={`${id}-sheen`} x1="0" y1="0" x2="0.4" y2="1">
              <stop offset="0%" stopColor="#ffffff" stopOpacity="0.9" />
              <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
            </linearGradient>
            <filter id={`${id}-soft`} x="-30%" y="-30%" width="160%" height="160%">
              <feGaussianBlur stdDeviation="3" />
            </filter>
          </defs>

          {/* the ground shadow keeps the glass sitting on something */}
          <ellipse cx="100" cy="171" rx="52" ry="8" fill="#22331f" opacity="0.1" filter={`url(#${id}-soft)`} />

          <motion.g
            animate={rings.spin && animate ? { rotate: 360 } : { rotate: 0 }}
            transition={
              rings.spin && animate
                ? { duration: 14, repeat: Infinity, ease: "linear" }
                : { duration: 0.6 }
            }
            style={{ originX: "100px", originY: "96px" }}
          >
            {/* parent A · warm ring */}
            <motion.g
              animate={{ opacity: rings.a ? 1 : 0.22, x: rings.a ? 0 : -6 }}
              transition={{ duration: 0.6, ease: [0.32, 0.72, 0, 1] }}
            >
              <circle cx="78" cy="96" r="46" fill="none" stroke={`url(#${id}-warm)`} strokeWidth="15" />
              <circle cx="78" cy="96" r="46" fill="none" stroke="#ffffff" strokeWidth="2" strokeOpacity="0.7" />
              <path d="M46 68 A46 46 0 0 1 84 51" fill="none" stroke="#fff" strokeWidth="4" strokeOpacity="0.85" strokeLinecap="round" />
            </motion.g>

            {/* parent B · cool ring */}
            <motion.g
              animate={{ opacity: rings.b ? 1 : 0.22, x: rings.b ? 0 : 6 }}
              transition={{ duration: 0.6, ease: [0.32, 0.72, 0, 1] }}
            >
              <circle cx="122" cy="96" r="46" fill="none" stroke={`url(#${id}-cool)`} strokeWidth="15" />
              <circle cx="122" cy="96" r="46" fill="none" stroke="#ffffff" strokeWidth="2" strokeOpacity="0.7" />
              <path d="M154 68 A46 46 0 0 0 116 51" fill="none" stroke="#fff" strokeWidth="4" strokeOpacity="0.85" strokeLinecap="round" />
            </motion.g>
          </motion.g>

          {/* what is born, at the intersection */}
          <motion.g
            initial={false}
            animate={{ opacity: rings.bead ? 1 : 0, scale: rings.bead ? 1 : 0.4 }}
            transition={{ duration: 0.55, ease: [0.32, 0.72, 0, 1] }}
            style={{ originX: "100px", originY: "96px" }}
          >
            <circle cx="100" cy="96" r="21" fill={`url(#${id}-clear)`} />
            <circle cx="100" cy="96" r="21" fill="none" stroke="#fff" strokeWidth="1.6" strokeOpacity="0.9" />
            <ellipse cx="92" cy="86" rx="7" ry="5" fill="#fff" opacity="0.85" transform="rotate(-28 92 86)" />
          </motion.g>

          {state === "warning" ? (
            <g>
              <circle cx="100" cy="96" r="17" fill="rgba(191,139,60,.22)" stroke="#bf8b3c" strokeWidth="2" />
              <path d="M100 86 L100 99" stroke="#8a6323" strokeWidth="4" strokeLinecap="round" />
              <circle cx="100" cy="106" r="2.6" fill="#8a6323" />
            </g>
          ) : null}

          {state === "wallet" ? (
            <g>
              <rect x="79" y="84" width="42" height="27" rx="8" fill="rgba(255,255,255,.7)" stroke="#3d5535" strokeWidth="2.4" />
              <circle cx="111" cy="97" r="3.6" fill="#3d5535" />
            </g>
          ) : null}
        </svg>
      </motion.div>
      {caption ? <p className="glass-mark-caption">{caption}</p> : null}
    </div>
  );
}
