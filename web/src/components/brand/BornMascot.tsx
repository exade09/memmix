import { useEffect, useId, useRef, useState } from "react";
import { motion, useInView, useReducedMotion } from "motion/react";

/*
  BORN — the MIXBORN operator.

  Hand-drawn hooded figure: heavy black ink outline, flat brown robe, and a
  black void where a face should be. The void is not decoration, it is the
  merge core. Parent A arrives as a copper orb, Parent B as an ash orb, they
  collide, and what is born appears as a cream point inside the hood.

  He is authored as SVG so he can react to real product state and scale to any
  size. Final raster art dropped into web/public/assets/brand/ as
  `born-portrait.png` / `born-full.png` is loaded over the top automatically,
  and the SVG becomes the fallback. Both sit on the same bone plate, so the
  composition does not change when the art arrives.
*/

export type BornState =
  | "idle"
  | "searching"
  | "ready"
  | "mixing"
  | "generating"
  | "success"
  | "warning"
  | "wallet"
  | "launched";

export type BornVariant = "portrait" | "full";

const RASTER: Record<BornVariant, string> = {
  portrait: "/assets/brand/born-portrait.png",
  full: "/assets/brand/born-full.png",
};

const ALT: Record<BornState, string> = {
  idle: "BORN, the MIXBORN operator: a hooded figure with a black void for a face, waiting.",
  searching: "BORN scanning for a parent token.",
  ready: "BORN holding two parent tokens, ready to mix.",
  mixing: "BORN mixing the logic of two parent tokens.",
  generating: "BORN drawing the avatar of the token being born.",
  success: "BORN presenting the token that was born.",
  warning: "BORN flagging a problem.",
  wallet: "BORN waiting for a wallet signature.",
  launched: "BORN with a token confirmed on-chain.",
};

type Glyph = "warn" | "born" | "wallet" | null;

function signalFor(state: BornState): { a: boolean; b: boolean; merged: boolean; glyph: Glyph } {
  switch (state) {
    case "searching":
      return { a: true, b: false, merged: false, glyph: null };
    case "ready":
      return { a: true, b: true, merged: false, glyph: null };
    case "mixing":
    case "generating":
      return { a: true, b: true, merged: true, glyph: null };
    case "success":
    case "launched":
      return { a: false, b: false, merged: false, glyph: "born" };
    case "warning":
      return { a: false, b: false, merged: false, glyph: "warn" };
    case "wallet":
      return { a: false, b: false, merged: false, glyph: "wallet" };
    default:
      return { a: false, b: false, merged: false, glyph: null };
  }
}

/**
 * What happens inside the hood, drawn in a normalised 100 x 100 box so the
 * portrait and the full-body figure can reuse it at different scales.
 */
function FaceSignal({
  state,
  animate,
  parentA,
  parentB,
}: {
  state: BornState;
  animate: boolean;
  parentA: boolean;
  parentB: boolean;
}) {
  const signal = signalFor(state);
  const showA = signal.a || parentA;
  const showB = signal.b || parentB;
  const merged = signal.merged;
  const spin = animate && (state === "mixing" || state === "generating");

  return (
    <g aria-hidden="true">
      {showA ? (
        <motion.circle
          r="8"
          fill="var(--copper)"
          initial={animate ? { cx: 50, cy: 50, opacity: 0 } : false}
          animate={{ cx: merged ? 50 : 33, cy: merged ? 50 : 52, opacity: merged ? 0.85 : 1 }}
          transition={{ duration: animate ? 0.5 : 0, ease: [0.32, 0.72, 0, 1] }}
        />
      ) : null}
      {showB ? (
        <motion.circle
          r="8"
          fill="var(--ash)"
          initial={animate ? { cx: 50, cy: 50, opacity: 0 } : false}
          animate={{ cx: merged ? 50 : 67, cy: merged ? 50 : 52, opacity: merged ? 0.85 : 1 }}
          transition={{ duration: animate ? 0.5 : 0, ease: [0.32, 0.72, 0, 1] }}
        />
      ) : null}

      {spin ? (
        <motion.g
          style={{ originX: "50px", originY: "50px" }}
          animate={{ rotate: 360 }}
          transition={{ duration: 2.6, repeat: Infinity, ease: "linear" }}
        >
          <circle
            cx="50"
            cy="50"
            r="24"
            fill="none"
            stroke="var(--cream)"
            strokeWidth="2.5"
            strokeOpacity="0.5"
            strokeDasharray="7 12"
            strokeLinecap="round"
          />
        </motion.g>
      ) : null}

      {signal.glyph === "born" ? (
        <motion.g
          initial={animate ? { scale: 0.4, opacity: 0 } : false}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.42, ease: [0.32, 0.72, 0, 1] }}
          style={{ originX: "50px", originY: "50px" }}
        >
          <circle cx="50" cy="50" r="19" fill="none" stroke="var(--born)" strokeWidth="4.5" />
          <circle cx="50" cy="50" r="5.5" fill="var(--born)" />
        </motion.g>
      ) : null}

      {signal.glyph === "warn" ? (
        <g>
          <path d="M50 30 L50 58" stroke="var(--warn)" strokeWidth="8" strokeLinecap="round" />
          <circle cx="50" cy="71" r="5" fill="var(--warn)" />
        </g>
      ) : null}

      {signal.glyph === "wallet" ? (
        <g>
          <rect x="28" y="36" width="44" height="30" rx="8" fill="none" stroke="var(--cream)" strokeWidth="4.5" />
          <circle cx="61" cy="51" r="4.5" fill="var(--cream)" />
        </g>
      ) : null}

      {state === "idle" && animate ? (
        <motion.circle
          cx="50"
          cy="52"
          r="3.6"
          fill="var(--cream)"
          initial={{ opacity: 0 }}
          animate={{ opacity: [0, 0.32, 0] }}
          transition={{ duration: 5, repeat: Infinity, times: [0, 0.5, 1], ease: "easeInOut" }}
        />
      ) : null}
    </g>
  );
}

function InkDefs({ id }: { id: string }) {
  return (
    <defs>
      {/* One turbulence pass gives every edge the wobble of a hand-drawn line. */}
      <filter id={`${id}-ink`} x="-10%" y="-10%" width="120%" height="120%">
        <feTurbulence type="fractalNoise" baseFrequency="0.017" numOctaves="3" seed="11" result="n" />
        <feDisplacementMap in="SourceGraphic" in2="n" scale="5" xChannelSelector="R" yChannelSelector="G" />
      </filter>
      <linearGradient id={`${id}-robe`} x1="0.1" y1="0" x2="0.9" y2="1">
        <stop offset="0%" stopColor="var(--robe-light)" />
        <stop offset="52%" stopColor="var(--robe)" />
        <stop offset="100%" stopColor="var(--robe-deep)" />
      </linearGradient>
    </defs>
  );
}

const P_SHOULDERS = "M-22 404 C-16 340 22 298 96 288 C162 278 264 278 324 290 C396 302 420 342 424 404 Z";
const P_HOOD =
  "M96 302 C86 232 86 146 102 92 C114 44 132 8 154 -12 C216 -6 288 34 320 108 C336 158 336 244 326 306 C256 326 164 324 96 302 Z";
const P_HOOD_BASE = "M96 302 C164 324 256 326 326 306";

function PortraitFigure({ id, state, animate, parentA, parentB }: FigureProps) {
  return (
    <svg viewBox="0 0 400 400" className="born-svg" role="img" aria-label={ALT[state]}>
      <InkDefs id={id} />
      <g filter={`url(#${id}-ink)`}>
        <path d={P_SHOULDERS} fill={`url(#${id}-robe)`} />
        <path
          d="M250 282 C296 296 322 342 330 404 L424 404 C420 342 396 302 324 290 Z"
          fill="var(--robe-shadow)"
          opacity="0.4"
        />
        <path d={P_HOOD} fill={`url(#${id}-robe)`} />
        {/* the lit side of the hood falls away to the right */}
        <path
          d="M234 156 C224 90 210 44 154 -12 C216 -6 288 34 320 108 C336 158 336 244 326 306 C298 312 268 314 240 314 Z"
          fill="var(--robe-deep)"
          opacity="0.5"
        />
        {/* inner hood band, thick on the left where the cloth folds */}
        <ellipse cx="232" cy="164" rx="82" ry="124" transform="rotate(-6 232 164)" fill="var(--robe-deep)" />
        {/* the void */}
        <ellipse cx="252" cy="176" rx="63" ry="107" transform="rotate(-6 252 176)" fill="var(--void-face)" />
        <path
          d="M230 176 C206 208 208 254 230 274 C254 294 288 280 294 250 C300 214 276 174 252 166 Z"
          fill="var(--void-face-lit)"
          opacity="0.3"
        />

        <g transform="translate(189 122) scale(1.26)">
          <FaceSignal state={state} animate={animate} parentA={parentA} parentB={parentB} />
        </g>

        {/* paper showing through where the ink missed the fill */}
        <g fill="none" stroke="#e8e3d7" strokeWidth="5" strokeLinecap="round">
          <path d="M104 288 C94 226 96 142 108 96" />
          <path d="M-4 400 C6 344 34 310 86 298" />
        </g>

        <g fill="none" stroke="#0a0a0a" strokeWidth="7.5" strokeLinecap="round" strokeLinejoin="round">
          <path d={P_SHOULDERS} />
          <path d={P_HOOD} />
          <path d={P_HOOD_BASE} strokeWidth="5" />
          <ellipse cx="252" cy="176" rx="63" ry="107" transform="rotate(-6 252 176)" strokeWidth="6" />
          <path d="M256 70 C252 86 252 98 254 110" strokeWidth="4" />
        </g>
      </g>
    </svg>
  );
}

const F_ROBE =
  "M94 218 C95 192 102 168 124 154 L216 154 C238 168 245 192 246 218 C250 302 250 392 248 470 C206 480 134 480 92 470 C90 392 90 302 94 218 Z";
const F_HOOD =
  "M124 158 C106 128 104 74 120 44 C132 22 154 10 178 14 C204 18 222 44 227 78 C231 110 225 138 217 160 C190 168 150 166 124 158 Z";

function FullFigure({ id, state, animate, parentA, parentB }: FigureProps) {
  return (
    <svg viewBox="0 -12 340 546" className="born-svg" role="img" aria-label={ALT[state]}>
      <InkDefs id={id} />
      <g filter={`url(#${id}-ink)`}>
        {/* shoes peek out from under the hem */}
        <ellipse cx="134" cy="484" rx="32" ry="16" fill="#2f2f34" />
        <ellipse cx="206" cy="484" rx="32" ry="16" fill="#2f2f34" />
        <g fill="none" stroke="#0a0a0a" strokeWidth="4.5">
          <ellipse cx="134" cy="484" rx="32" ry="16" />
          <ellipse cx="206" cy="484" rx="32" ry="16" />
        </g>

        <path d={F_ROBE} fill={`url(#${id}-robe)`} />
        <path
          d="M176 156 C188 246 194 364 192 476 C214 476 236 473 248 470 C250 392 250 302 246 218 C245 192 238 168 216 154 Z"
          fill="var(--robe-shadow)"
          opacity="0.38"
        />
        <path d="M122 186 C116 264 116 372 120 464" fill="none" stroke="var(--robe-shadow)" strokeWidth="3" opacity="0.5" />
        <path d="M218 186 C224 264 224 372 220 464" fill="none" stroke="var(--robe-shadow)" strokeWidth="3" opacity="0.5" />

        <path d={F_HOOD} fill={`url(#${id}-robe)`} />
        <path
          d="M188 66 C184 42 182 26 178 14 C204 18 222 44 227 78 C231 110 225 138 217 160 C207 163 197 165 188 166 Z"
          fill="var(--robe-deep)"
          opacity="0.5"
        />
        <ellipse cx="168" cy="88" rx="38" ry="56" transform="rotate(-6 168 88)" fill="var(--robe-deep)" />
        <ellipse cx="179" cy="93" rx="29" ry="47" transform="rotate(-6 179 93)" fill="var(--void-face)" />
        <path
          d="M169 96 C157 110 157 130 169 140 C182 150 197 142 199 128 C202 111 190 92 178 90 Z"
          fill="var(--void-face-lit)"
          opacity="0.3"
        />

        <g transform="translate(152 65) scale(0.55)">
          <FaceSignal state={state} animate={animate} parentA={parentA} parentB={parentB} />
        </g>

        <g fill="none" stroke="#e8e3d7" strokeWidth="3" strokeLinecap="round" opacity="0.85">
          <path d="M130 150 C114 122 113 76 126 50" />
          <path d="M100 236 C97 312 96 388 97 454" strokeWidth="2.5" />
        </g>

        <g fill="none" stroke="#0a0a0a" strokeWidth="5.5" strokeLinecap="round" strokeLinejoin="round">
          <path d={F_ROBE} />
          <path d={F_HOOD} />
          <ellipse cx="179" cy="93" rx="29" ry="47" transform="rotate(-6 179 93)" strokeWidth="4.5" />
          <path d="M181 42 C179 52 179 60 180 68" strokeWidth="3" />
        </g>
      </g>
    </svg>
  );
}

type FigureProps = {
  id: string;
  state: BornState;
  animate: boolean;
  parentA: boolean;
  parentB: boolean;
};

export function BornMascot({
  state = "idle",
  variant = "portrait",
  parentA = false,
  parentB = false,
  quiet = false,
  lit = false,
  className = "",
  caption,
}: {
  state?: BornState;
  variant?: BornVariant;
  parentA?: boolean;
  parentB?: boolean;
  /** Suppress ambient looping motion even when the figure is on screen. */
  quiet?: boolean;
  /** Paint the state halo behind the plate. Used for hero figures only. */
  lit?: boolean;
  className?: string;
  caption?: string;
}) {
  const id = useId().replace(/[^a-zA-Z0-9-]/g, "");
  const reduceMotion = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { amount: 0.2 });
  const [pageVisible, setPageVisible] = useState(
    () => typeof document === "undefined" || !document.hidden,
  );
  const [raster, setRaster] = useState(false);

  useEffect(() => {
    const sync = () => setPageVisible(!document.hidden);
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, []);

  // Looping motion stops off-viewport, in a hidden tab and under reduced motion.
  const animate = Boolean(!reduceMotion && inView && pageVisible && !quiet);
  const Figure = variant === "full" ? FullFigure : PortraitFigure;

  return (
    <div
      ref={ref}
      className={`born ${variant}${lit ? " is-lit" : ""} ${className}`.trim()}
      data-state={state}
      data-offscreen={inView ? "false" : "true"}
      data-reduced={reduceMotion ? "true" : "false"}
    >
      <div className="born-plate">
        <Figure id={id} state={state} animate={animate} parentA={parentA} parentB={parentB} />
        {/*
          Final art dropped into web/public/assets/brand/ takes over from here.
          A missing file simply never fades in.
        */}
        <img
          className={`born-raster${raster ? " is-on" : ""}`}
          src={RASTER[variant]}
          alt={raster ? ALT[state] : ""}
          aria-hidden={raster ? undefined : true}
          loading="lazy"
          decoding="async"
          onLoad={(event) => {
            if (event.currentTarget.naturalWidth > 8) setRaster(true);
          }}
          onError={(event) => {
            event.currentTarget.style.display = "none";
          }}
        />
        <span className="born-grain" aria-hidden="true" />
      </div>
      {caption ? <p className="born-caption">{caption}</p> : null}
    </div>
  );
}
