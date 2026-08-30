import { Outlet, useLocation, useSearchParams } from "react-router-dom";
import { useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";
import { Atmosphere } from "../brand/Atmosphere";
import { GlobalSearchDialog } from "../search/GlobalSearchDialog";
import { AppSidebar, MobileBottomNav } from "./AppNav";
import { SiteHeader } from "./SiteHeader";

export function PageShell() {
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const reduceMotion = useReducedMotion();
  const [searchOpen, setSearchOpen] = useState(false);
  const isApp = location.pathname.startsWith("/app") || location.pathname.startsWith("/token/");

  useEffect(() => {
    const sync = () => {
      document.body.dataset.pageHidden = document.hidden ? "true" : "false";
    };
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, []);

  useEffect(() => {
    if (location.hash !== "#mascot") return;
    document.getElementById("mascot")?.scrollIntoView({
      behavior: reduceMotion ? "auto" : "smooth",
      block: "start",
    });
  }, [location.hash, reduceMotion]);

  useEffect(() => {
    if (params.get("search") === "1") {
      setSearchOpen(true);
      params.delete("search");
      setParams(params, { replace: true });
    }
  }, [params, setParams]);

  return (
    <div className="shell">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <Atmosphere />
      <SiteHeader onOpenSearch={() => setSearchOpen(true)} />
      <GlobalSearchDialog open={searchOpen} onClose={() => setSearchOpen(false)} />
      {isApp ? (
        <div className="app-frame">
          <AppSidebar />
          <main id="main-content" className="app-main" tabIndex={-1}>
            <Outlet />
          </main>
        </div>
      ) : (
        <main id="main-content" tabIndex={-1}>
          <Outlet />
        </main>
      )}
      {isApp ? <MobileBottomNav /> : null}
    </div>
  );
}
