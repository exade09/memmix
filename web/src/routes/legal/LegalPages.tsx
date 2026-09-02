import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { SiteFooter } from "../../components/layout/SiteFooter";
import { SafetyBanner } from "../../components/layout/SafetyBanner";
import { ButtonLink } from "../../components/ui/Button";
import {
  CONTENT_POLICY,
  FAQ_ITEMS,
  FOOTER_DISCLAIMER,
  NOT_PROMISED,
  PRIVACY_COPY,
  RISK_DISCLOSURE,
  SAFETY_PILLARS,
  ZERO_PLATFORM_FEE,
} from "../../domain/legalCopy";
import { analyticsOptedOut, setAnalyticsOptOut } from "../../services/analytics";

function LegalShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <>
      <div className="section">
        <div className="wrap legal-page">
          <p className="eyebrow">Legal</p>
          <h1>{title}</h1>
          {children}
          <SafetyBanner showFee />
        </div>
      </div>
      <SiteFooter />
    </>
  );
}

export function LegalHubPage() {
  return (
    <LegalShell title="Legal">
      <p className="body-copy">{FOOTER_DISCLAIMER}</p>
      <nav className="btn-row" aria-label="Legal pages">
        <ButtonLink to="/safety" variant="outline" size="sm">
          Safety
        </ButtonLink>
        <ButtonLink to="/terms" variant="outline" size="sm">
          Terms
        </ButtonLink>
        <ButtonLink to="/privacy" variant="outline" size="sm">
          Privacy
        </ButtonLink>
      </nav>
      <h3>What FONS can verify</h3>
      <ul className="legal-list">
        <li>Non-custodial: keys stay in MetaMask.</li>
        <li>Explicit signature: nothing is sent until you approve it.</li>
        <li>Transaction simulation before MetaMask opens.</li>
        <li>The launchpad contract is verified to hold code before signing.</li>
        <li>Visible wallet debit on the review screen.</li>
        <li>No hidden FONS platform launch fee in this version.</li>
      </ul>
      <h3>What FONS does not promise</h3>
      <ul className="legal-list">
        {NOT_PROMISED.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </LegalShell>
  );
}

export function SafetyPage() {
  return (
    <LegalShell title="Safe to sign. Never safe to assume">
      <SafetyBanner />
      <p className="note">{ZERO_PLATFORM_FEE}</p>
      <ol className="pillar-grid">
        {SAFETY_PILLARS.map(([title, copy], index) => (
          <li key={title} className="pillar-card">
            <span className="step-index">{String(index + 1).padStart(2, "0")}</span>
            <h3>{title}</h3>
            <p>{copy}</p>
          </li>
        ))}
      </ol>
      <h3>Process, not market</h3>
      <p className="body-copy">
        FONS protects the launch workflow. It does not make a token safe, liquid, honest or valuable after it exists.
      </p>
      <ul className="legal-list">
        {NOT_PROMISED.map((item) => (
          <li key={item}>Not promised: {item}.</li>
        ))}
      </ul>
      <h3>FAQ</h3>
      <div className="faq-list">
        {FAQ_ITEMS.map(([question, answer]) => (
          <details key={question} className="disclosure faq-item">
            <summary>{question}</summary>
            <div className="disclosure-body">
              <p className="body-copy">{answer}</p>
            </div>
          </details>
        ))}
      </div>
    </LegalShell>
  );
}

export function TermsPage() {
  return (
    <LegalShell title="Terms">
      <p className="body-copy">{RISK_DISCLOSURE}</p>
      <p className="body-copy">
        The launcher is responsible for having the right to use uploaded names, images and links. AI output must also be
        reviewed before launch. Treat submitted token data as permanent.
      </p>
      <p className="body-copy">{ZERO_PLATFORM_FEE}</p>
      <p className="body-copy">{FOOTER_DISCLAIMER}</p>
      <h3>Content that is blocked or requires review</h3>
      <ul className="legal-list">
        {CONTENT_POLICY.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
      <p className="body-copy">
        Blockscout, DexScreener and social links are third-party sites. Review them yourself.
      </p>
    </LegalShell>
  );
}

export function PrivacyPage() {
  const [optedOut, setOptedOut] = useState(analyticsOptedOut);

  function onToggle(next: boolean) {
    setAnalyticsOptOut(next);
    setOptedOut(next);
  }

  return (
    <LegalShell title="Privacy">
      <p className="body-copy">{PRIVACY_COPY}</p>
      <label className="confirm-row">
        <input type="checkbox" checked={optedOut} onChange={(event) => onToggle(event.currentTarget.checked)} />
        Do not record anonymous product events in this browser.
      </label>
      <p className="metric-label">
        Refusing analytics does not disable mix, launch, search or wallet. Events never include a raw wallet address or
        signed transaction bytes.
      </p>
    </LegalShell>
  );
}

export function NotFoundPage() {
  return (
    <div className="section">
      <div className="wrap stack lg not-found">
        <p className="eyebrow">404</p>
        <h1>This mutation did not survive</h1>
        <p className="body-copy">Everything else is still on the bench</p>
        <div className="btn-row">
          <ButtonLink to="/" variant="primary" arrow>
            Back to the lab
          </ButtonLink>
          <Link to="/app/explore" className="btn ghost">
            Explore tokens
          </Link>
        </div>
      </div>
    </div>
  );
}
