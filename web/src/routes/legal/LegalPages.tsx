import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { SiteFooter } from "../../components/layout/SiteFooter";
import { ButtonLink } from "../../components/ui/Button";
import { AnimatedText } from "../../components/motion/AnimatedText";
import {
  CONTENT_POLICY,
  FOOTER_DISCLAIMER,
  NOT_PROMISED,
  PRIVACY_COPY,
  RISK_DISCLOSURE,
  ZERO_PLATFORM_FEE,
} from "../../domain/legalCopy";
import { analyticsOptedOut, setAnalyticsOptOut } from "../../services/analytics";

function LegalShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <>
      <div className="section">
        <div className="wrap legal-page">
          <p className="eyebrow">Legal</p>
          <AnimatedText as="h1" reveal="lines" lines={[title]} />
          {children}
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
        <AnimatedText as="h1" reveal="lines" lines={["This mutation did not survive"]} />
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
