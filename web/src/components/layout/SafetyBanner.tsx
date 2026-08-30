import { RISK_DISCLOSURE, SAFETY_PROMISE, ZERO_PLATFORM_FEE } from "../../domain/legalCopy";

export function SafetyBanner({ showFee = false }: { showFee?: boolean }) {
  return (
    <aside className="safety-stack" aria-label="Safety disclosures">
      <p className="note live">{SAFETY_PROMISE}</p>
      <p className="note warn">{RISK_DISCLOSURE}</p>
      {showFee ? <p className="note">{ZERO_PLATFORM_FEE}</p> : null}
    </aside>
  );
}
