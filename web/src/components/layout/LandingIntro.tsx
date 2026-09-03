import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { GlassMark } from "../brand/GlassMark";
import { EASE } from "../motion/motion";

export const INTRO_READY_DELAY_MS = 1050;

export function isIntroStartKey(event: {
  key: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}): boolean {
  if (event.altKey || event.ctrlKey || event.metaKey) return false;
  return !["Alt", "Control", "Meta", "Shift", "Tab"].includes(event.key);
}

export function LandingIntro({ onStart }: { onStart: () => void }) {
  const reduceMotion = useReducedMotion();
  const [ready, setReady] = useState(false);
  const started = useRef(false);
  const startButton = useRef<HTMLButtonElement>(null);

  const start = useCallback(() => {
    if (!ready || started.current) return;
    started.current = true;
    onStart();
  }, [onStart, ready]);

  useEffect(() => {
    document.body.dataset.introOpen = "true";
    return () => {
      delete document.body.dataset.introOpen;
    };
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(
      () => setReady(true),
      reduceMotion ? 240 : INTRO_READY_DELAY_MS,
    );
    return () => window.clearTimeout(timer);
  }, [reduceMotion]);

  useEffect(() => {
    if (!ready) return;
    startButton.current?.focus({ preventScroll: true });
  }, [ready]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Tab") {
        event.preventDefault();
        event.stopPropagation();
        if (ready) startButton.current?.focus({ preventScroll: true });
        return;
      }
      if (!isIntroStartKey(event)) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (ready) start();
    }

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [ready, start]);

  return createPortal(
    <motion.div
      className="landing-intro"
      role="dialog"
      aria-modal="true"
      aria-label="Enter Fons"
      initial={reduceMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, filter: reduceMotion ? "none" : "blur(5px)" }}
      transition={{ duration: reduceMotion ? 0.08 : 0.42, ease: EASE }}
      onPointerDown={ready ? start : undefined}
    >
      <motion.div
        className="landing-intro-window"
        data-ready={ready ? "true" : "false"}
        initial={
          reduceMotion
            ? false
            : { opacity: 0, y: 18, scale: 0.955, filter: "blur(7px)" }
        }
        animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
        exit={
          reduceMotion
            ? { opacity: 0 }
            : { opacity: 0, y: -10, scale: 0.98, filter: "blur(4px)" }
        }
        transition={{ duration: reduceMotion ? 0.08 : 0.58, ease: EASE }}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="landing-intro-glow" aria-hidden="true" />
        <div className="landing-intro-mark">
          <GlassMark
            state={ready ? "ready" : "generating"}
            className="landing-intro-logo"
            quiet={Boolean(reduceMotion)}
          />
        </div>

        <div className="landing-intro-status" aria-live="polite">
          <AnimatePresence mode="wait" initial={false}>
            {ready ? (
              <motion.button
                key="ready"
                ref={startButton}
                type="button"
                className="landing-intro-start"
                initial={reduceMotion ? false : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: reduceMotion ? 0.08 : 0.34, ease: EASE }}
                onClick={start}
              >
                <span>Press any button to start build</span>
                <i aria-hidden="true">→</i>
              </motion.button>
            ) : (
              <motion.div
                key="loading"
                className="landing-intro-progress"
                exit={{ opacity: 0, scaleX: 0.94 }}
                transition={{ duration: reduceMotion ? 0.08 : 0.2, ease: EASE }}
                role="progressbar"
                aria-label="Loading Fons"
              >
                <motion.i
                  initial={{ scaleX: 0 }}
                  animate={{ scaleX: 1 }}
                  transition={{
                    duration: reduceMotion ? 0.18 : INTRO_READY_DELAY_MS / 1000,
                    ease: EASE,
                  }}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </motion.div>,
    document.body,
  );
}
