import { useState } from "react";
import { motion, useReducedMotion } from "motion/react";

/*
  A token's picture, or an honest stand-in for it.

  The old fallback was `token-fallback.webp`, which is the FONS mark: every
  token without an image rendered wearing our logo, so unrelated tokens looked
  like ours. A placeholder must not claim authorship of somebody else's token.

  What replaces it is the token's own initials on a neutral tile, tinted from
  its address so two imageless tokens are still visually distinct. It reads as
  "no picture", which is the truth, and it belongs to the token rather than to
  us.
*/

function initials(symbol: string, name: string): string {
  const source = (symbol || name || "").replace(/[^A-Za-z0-9]/g, "");
  return source.slice(0, 2).toUpperCase() || "?";
}

/** A stable hue per token, so the tiles are distinguishable but never loud. */
function hue(seed: string): number {
  let acc = 0;
  for (let i = 0; i < seed.length; i += 1) acc = (acc * 31 + seed.charCodeAt(i)) % 360;
  return acc;
}

export function TokenAvatar({
  src,
  symbol = "",
  name = "",
  seed = "",
  size = 48,
  className = "",
  layoutId,
}: {
  src?: string | null;
  symbol?: string;
  name?: string;
  /** Usually the contract address; falls back to the symbol. */
  seed?: string;
  size?: number;
  className?: string;
  layoutId?: string;
}) {
  const reduceMotion = useReducedMotion();
  const [failed, setFailed] = useState(false);
  const shared = reduceMotion ? undefined : layoutId;
  const transition = { duration: 0.22, ease: [0.32, 0.72, 0, 1] } as const;

  if (src && !failed) {
    return (
      <motion.img
        className={`avatar ${className}`.trim()}
        src={src}
        alt={name ? `${name} avatar` : ""}
        width={size}
        height={size}
        loading="lazy"
        // A dead image URL must not leave a broken-image glyph behind.
        onError={() => setFailed(true)}
        layoutId={shared}
        transition={transition}
      />
    );
  }

  const label = initials(symbol, name);
  return (
    <motion.span
      className={`avatar token-avatar-blank ${className}`.trim()}
      style={{
        width: size,
        height: size,
        fontSize: Math.max(10, Math.round(size * 0.36)),
        // Low saturation and high lightness keep this a placeholder, not a badge.
        background: `hsl(${hue(seed || symbol || name)} 24% 92%)`,
      }}
      aria-label={name ? `${name} has no image` : "No image"}
      role="img"
      layoutId={shared}
      transition={transition}
    >
      {label}
    </motion.span>
  );
}
