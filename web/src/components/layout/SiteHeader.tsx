import { useEffect } from "react";
import { NavLink } from "react-router-dom";
import { Wordmark } from "../brand/Wordmark";
import { CaBadge } from "./CaBadge";
import { WalletButton } from "../wallet/WalletButton";
import { NetworkBadge } from "./NetworkBadge";

const links = [
  { to: "/app/mix", label: "Mix" },
  { to: "/app/launch", label: "Launch" },
  { to: "/app/explore", label: "Explore" },
  { to: "/docs", label: "Docs" },
];

export function SiteHeader({ onOpenSearch }: { onOpenSearch: () => void }) {
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
      <div className="site-header-brand">
        <Wordmark />
        <CaBadge />
      </div>
      <nav className="header-nav" aria-label="FONS">
        {links.map((link) => (
          <NavLink
            key={link.to}
            to={link.to}
            className={({ isActive }) => `nav-link${isActive ? " is-active" : ""}`}
          >
            {link.label}
          </NavLink>
        ))}
      </nav>
      <div className="header-tools">
        <a
          className="icon-chip"
          href="https://x.com/fonsfamily"
          target="_blank"
          rel="noreferrer"
          aria-label="Fons on X"
        >
          <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
            <path d="M9.35 6.79 14.9 0h-1.31L8.77 5.9 4.71 0H0l5.83 8.49L0 15.6h1.31l5.1-6.24 4.07 6.24H15l-5.65-8.81Zm-1.8 2.21-.59-.86L1.78 1.04h2.01l3.79 5.5.59.86 4.93 7.16h-2.01L7.55 9Z" />
          </svg>
        </a>
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
