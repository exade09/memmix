import { useState } from "react";

/*
  The face of whatever is being paid out: ETH, or a tokenized equity.

  Deliberately no guessed logo URLs. Tokenized equities carry no artwork in
  any feed this site already uses, and inventing a CDN path produces a broken
  image for every asset rather than a missing one for a few. So the default
  is the ticker itself, set in the same mono face the rest of the interface
  uses for symbols -- always correct, always loads, and unambiguous in a way
  a logo alone is not.

  A real image is used when one is actually supplied, which is how meme
  tokens with their own art will render if they are ever paid out here.
*/

const NATIVE = "0x0000000000000000000000000000000000000000";

export function AssetBadge({
  symbol,
  address,
  logoUrl,
}: {
  symbol: string;
  address: string;
  /** Only passed when the asset genuinely has artwork. Never guessed. */
  logoUrl?: string | null;
}) {
  const [failed, setFailed] = useState(false);
  const isNative = !address || address.toLowerCase() === NATIVE;

  if (isNative) {
    return (
      <span className="asset-badge is-native" title="ETH">
        <svg viewBox="0 0 32 32" role="img" aria-label="ETH">
          <path d="M16 3 9 16.2 16 20.4l7-4.2L16 3Z" fill="currentColor" opacity="0.9" />
          <path d="M16 21.9 9 17.7 16 29l7-11.3-7 4.2Z" fill="currentColor" opacity="0.55" />
        </svg>
      </span>
    );
  }

  if (logoUrl && !failed) {
    return (
      <span className="asset-badge" title={symbol}>
        <img src={logoUrl} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} />
      </span>
    );
  }

  return (
    <span className="asset-badge is-ticker" title={symbol} aria-label={symbol}>
      {symbol.slice(0, 5)}
    </span>
  );
}
