import { useLocation } from "react-router-dom";
import { AnimatePresence, motion, useInView, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { EASE } from "../motion/motion";

/*
  The creation flow, framed as an application rather than as more page.

  Everything under /app is a tool: you pick two tokens, edit four fields and
  sign a transaction. Presenting it on the same open meadow as the marketing
  copy makes it read as another scrolling section. Putting it inside a window
  with its own chrome, its own ground and its own edge says plainly that you
  have stepped out of the site and into the thing the site is about.

  The window opens rather than appears: it lifts and settles once, the way an
  application does. That is the only place in the product where motion is
  allowed to be noticeable.
*/

const TITLES: Record<string, string> = {
  "/app/mix": "FONS · MIX",
  "/app/launch": "FONS · LAUNCH",
  "/app/launch/success": "FONS · LAUNCHED",
  "/app/explore": "FONS · EXPLORE",
};

function windowTitle(pathname: string): string {
  if (TITLES[pathname]) return TITLES[pathname];
  if (pathname.startsWith("/token/")) return "FONS · TOKEN";
  return "FONS";
}

export function AppWindow({ children }: { children: ReactNode }) {
  const location = useLocation();
  const reduceMotion = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { amount: 0.08 });
  const [pageVisible, setPageVisible] = useState(
    () => typeof document === "undefined" || !document.hidden,
  );
  const title = windowTitle(location.pathname);
  const ambient = Boolean(!reduceMotion && inView && pageVisible);

  useEffect(() => {
    const sync = () => setPageVisible(!document.hidden);
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, []);

  const chrome = (
    <div className="app-window-bar">
      <span>
        <span className="chrome-lights" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={title}
            className="app-window-title"
            initial={reduceMotion ? false : { opacity: 0, y: 5, filter: "blur(2px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, y: -4, filter: "blur(2px)" }}
            transition={{ duration: reduceMotion ? 0 : 0.22, ease: EASE }}
          >
            {title}
          </motion.span>
        </AnimatePresence>
      </span>
      <motion.span
        key={location.pathname}
        className="app-window-path"
        aria-hidden="true"
        initial={reduceMotion ? false : { opacity: 0, x: 6 }}
        animate={{ opacity: 0.62, x: 0 }}
        transition={{ duration: reduceMotion ? 0 : 0.24, ease: EASE }}
      >
        {location.pathname}
      </motion.span>
    </div>
  );

  if (reduceMotion) {
    return (
      <div className="app-window">
        {chrome}
        <div className="app-window-body">{children}</div>
      </div>
    );
  }

  return (
    <motion.div
      ref={ref}
      className="app-window"
      initial={{ opacity: 0, y: 18, scale: 0.985 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.46, ease: EASE }}
    >
      <motion.span
        className="app-window-ambient"
        aria-hidden="true"
        initial={{ x: "-140%" }}
        animate={ambient ? { x: ["-140%", "520%"] } : { x: "-140%" }}
        transition={
          ambient
            ? { duration: 2.2, repeat: Infinity, repeatDelay: 3.8, ease: EASE }
            : { duration: 0.2, ease: EASE }
        }
      />
      {chrome}
      <div className="app-window-body">{children}</div>
    </motion.div>
  );
}
