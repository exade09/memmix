import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { motion, useReducedMotion } from "motion/react";

const SESSION_KEY = "mixborn.logoBirthPlayed"; // storage key kept: renaming it would replay the intro for everyone

/*
  The O of FONS, at wordmark size.

  This is the real logo simplified, not a different mark: the same two
  interlocking rings on the same diagonal. The rendered glass version is
  photographic and turns to mush below about 40px, so small sizes get the
  vector and everything larger gets the render (see GlassMark).
*/
export function MergeMark({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <g transform="rotate(-32 16 16)">
        <ellipse cx="16" cy="11.4" rx="7.2" ry="9.4" stroke="var(--moss)" strokeWidth="2.5" />
        <ellipse cx="16" cy="20.6" rx="7.2" ry="9.4" stroke="var(--sage)" strokeWidth="2.5" />
      </g>
    </svg>
  );
}

export function Wordmark({ to = "/", sub }: { to?: string; sub?: string }) {
  const reduceMotion = useReducedMotion();
  const [born, setBorn] = useState(() => {
    try {
      return sessionStorage.getItem(SESSION_KEY) === "1";
    } catch {
      return true;
    }
  });
  const showMark = born || Boolean(reduceMotion);

  useEffect(() => {
    if (reduceMotion) {
      try {
        sessionStorage.setItem(SESSION_KEY, "1");
      } catch {
        // Session storage is optional; the mark still resolves.
      }
      setBorn(true);
      return;
    }
    if (born) return;
    const timer = window.setTimeout(() => {
      try {
        sessionStorage.setItem(SESSION_KEY, "1");
      } catch {
        // Session storage is optional; the mark still resolves.
      }
      setBorn(true);
    }, 820);
    return () => window.clearTimeout(timer);
  }, [reduceMotion, born]);

  return (
    <Link to={to} className="wordmark" aria-label="FONS">
      <span>F</span>
      <span className="wordmark-slot" aria-hidden="true">
        {showMark ? (
          <motion.span
            initial={born ? false : { opacity: 0, scale: 0.7 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: reduceMotion ? 0.1 : 0.24, ease: [0.32, 0.72, 0, 1] }}
            style={{ display: "grid", placeItems: "center", width: "100%", height: "100%" }}
          >
            <MergeMark />
          </motion.span>
        ) : (
          <>
            <span className="wordmark-void" />
            <motion.i
              className="wordmark-orb a"
              initial={{ x: -13, opacity: 0.2, scale: 0.5 }}
              animate={{ x: -3, opacity: 1, scale: 1 }}
              transition={{ duration: 0.46, ease: "easeOut" }}
            />
            <motion.i
              className="wordmark-orb b"
              initial={{ x: 13, opacity: 0.2, scale: 0.5 }}
              animate={{ x: 3, opacity: 1, scale: 1 }}
              transition={{ duration: 0.46, ease: "easeOut" }}
            />
          </>
        )}
      </span>
      <span>NS</span>
      {sub ? <span className="wordmark-sub">{sub}</span> : null}
    </Link>
  );
}
