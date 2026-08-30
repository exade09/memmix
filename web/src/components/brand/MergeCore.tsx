import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { MergeMark } from "./Wordmark";
import type { ParentToken } from "../../domain/draft";

/**
 * The bench output slot. Two parents drift in, collide, and settle as one
 * born mark. Nothing here claims a result the app has not produced yet.
 */
export function MergeCore({
  parentA,
  parentB,
}: {
  parentA: ParentToken | null;
  parentB: ParentToken | null;
}) {
  const reduceMotion = useReducedMotion();
  const both = Boolean(parentA && parentB);
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    setSettled(false);
    if (!both) return;
    if (reduceMotion) {
      setSettled(true);
      return;
    }
    const timer = window.setTimeout(() => setSettled(true), 820);
    return () => window.clearTimeout(timer);
  }, [both, parentA?.mint, parentB?.mint, reduceMotion]);

  return (
    <div
      className={`merge-core${both ? (settled ? " is-born" : " is-merging") : ""}`}
      aria-live="polite"
    >
      {!both ? (
        <span className="merge-core-label">UNKNOWN</span>
      ) : settled || reduceMotion ? (
        <div className="merge-core-born">
          <MergeMark className="merge-core-mark" />
          <span>BORN</span>
        </div>
      ) : (
        <>
          <motion.img
            className="merge-core-avatar a"
            src={parentA?.image_url || "/assets/brand/mark-merge-o.svg"}
            alt=""
            initial={{ x: -26, opacity: 0.4 }}
            animate={{ x: -5, opacity: 1 }}
            transition={{ duration: 0.46, ease: "easeOut" }}
          />
          <motion.img
            className="merge-core-avatar b"
            src={parentB?.image_url || "/assets/brand/mark-merge-o.svg"}
            alt=""
            initial={{ x: 26, opacity: 0.4 }}
            animate={{ x: 5, opacity: 1 }}
            transition={{ duration: 0.46, ease: "easeOut" }}
          />
          <span className="merge-core-split" aria-hidden="true" />
        </>
      )}
    </div>
  );
}
