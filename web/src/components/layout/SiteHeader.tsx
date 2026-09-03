import { useEffect } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { Wordmark } from "../brand/Wordmark";
import { WalletButton } from "../wallet/WalletButton";
import { NetworkBadge } from "./NetworkBadge";

const links = [
  { to: "/app/mix", label: "Mix" },
  { to: "/app/launch", label: "Launch" },
  { to: "/app/explore", label: "Explore" },
  { to: "/#mascot", label: "Mark" },
  { to: "/docs", label: "Docs" },
  { to: "/safety", label: "Safety" },
];

export function SiteHeader({ onOpenSearch }: { onOpenSearch: () => void }) {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        onOpenSearch();
        return;
      }
      if (event.key === "/" && !typing && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        onOpenSearch();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onOpenSearch]);

  return (
    <header className="site-header">
      <Wordmark />
      <nav className="header-nav" aria-label="FONS">
        {links.map((link) => {
          if (link.to.startsWith("/#")) {
            const onLanding = location.pathname === "/";
            return (
              <a
                key={link.label}
                className={`nav-link${onLanding && location.hash === "#mascot" ? " is-active" : ""}`}
                href={link.to}
                onClick={(event) => {
                  if (location.pathname !== "/") {
                    event.preventDefault();
                    navigate("/#mascot");
                    return;
                  }
                  event.preventDefault();
                  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
                  document.getElementById("mascot")?.scrollIntoView({
                    behavior: reduce ? "auto" : "smooth",
                    block: "start",
                  });
                  window.history.replaceState(null, "", "/#mascot");
                }}
              >
                {link.label}
              </a>
            );
          }
          return (
            <NavLink
              key={link.to}
              to={link.to}
              className={({ isActive }) => `nav-link${isActive ? " is-active" : ""}`}
            >
              {link.label}
            </NavLink>
          );
        })}
      </nav>
      <div className="header-tools">
        <button
          type="button"
          className="search-chip"
          aria-keyshortcuts="Control+K Meta+K"
          aria-label="Open search"
          onClick={onOpenSearch}
        >
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
            <circle cx="7" cy="7" r="4.6" />
            <path d="M10.4 10.4 14 14" strokeLinecap="round" />
          </svg>
          <span>Search</span>
          <kbd>⌘K</kbd>
        </button>
        <NetworkBadge />
        <WalletButton />
      </div>
    </header>
  );
}
