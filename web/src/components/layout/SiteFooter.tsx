import { Link } from "react-router-dom";
import { appConfig } from "../../app/config";
import { FOOTER_DISCLAIMER } from "../../domain/legalCopy";
import { Wordmark } from "../brand/Wordmark";
import { SectionReveal } from "../motion/SectionReveal";

export function SiteFooter() {
  return (
    <SectionReveal as="footer" className="site-footer" ariaLabel="Footer">
      <div className="wrap">
        <div className="footer-top">
          <div className="footer-brand stack sm">
            <Wordmark />
            <p>Two tokens in One born</p>
            <p className="metric-label">
              ${appConfig.tokenSymbol} is the project&apos;s own ticker, not a promise about any token you launch
            </p>
          </div>
          <div className="footer-col">
            <h4>The lab</h4>
            <Link to="/app/mix">AI Mix</Link>
            <Link to="/app/launch">Direct Launch</Link>
            <Link to="/app/explore">Explore</Link>
            <Link to="/docs">Docs</Link>
          </div>
          <div className="footer-col">
            <h4>Read first</h4>
            <Link to="/terms">Terms</Link>
            <Link to="/privacy">Privacy</Link>
            <Link to="/legal">Legal</Link>
            <a href="https://x.com/fonsfamily" target="_blank" rel="noreferrer">
              X
            </a>
          </div>
        </div>
        <div className="footer-legal">
          <p>Built on Robinhood Chain. Not affiliated with Robinhood Markets</p>
          <p>{FOOTER_DISCLAIMER}</p>
        </div>
      </div>
      <span className="footer-watermark" aria-hidden="true">
        FONS
      </span>
    </SectionReveal>
  );
}
