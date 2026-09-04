import { Atmosphere } from "../brand/Atmosphere";
import { GlassMark } from "../brand/GlassMark";
import { Wordmark } from "../brand/Wordmark";
import { AnimatedText } from "../motion/AnimatedText";

/*
  A temporary, whole-site gate: every route except /admin/ca renders this
  instead of the real app while VITE_SITE_GATE_ENABLED is "true". Nothing
  underneath is touched or removed -- flipping the flag back off in Vercel
  and redeploying restores the site exactly as it was, with no code change.
*/
export function ComingSoonGate() {
  return (
    <div className="shell">
      <Atmosphere />
      <main id="main-content" className="section coming-soon">
        <div className="wrap stack lg coming-soon-inner">
          <Wordmark to="/" />
          <GlassMark state="idle" className="sz-md" />
          <p className="eyebrow">Fons</p>
          <AnimatedText as="h1" reveal="lines" lines={["Coming soon"]} />
          <p className="body-copy">Two tokens in, one born. Not open yet.</p>
          <div className="btn-row">
            <a className="btn outline" href="https://x.com/fonsfamily" target="_blank" rel="noreferrer">
              Follow for updates
            </a>
          </div>
        </div>
      </main>
    </div>
  );
}
