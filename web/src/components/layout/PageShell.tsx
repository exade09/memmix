import { Outlet, useLocation, useSearchParams } from "react-router-dom";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { pageVariants } from "../motion/motion";
import { useEffect, useState, type ReactNode } from "react";
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
            <RouteTransition>
              <Outlet />
            </RouteTransition>
          </main>
        </div>
      ) : (
        <main id="main-content" tabIndex={-1}>
          <RouteTransition>
            <Outlet />
          </RouteTransition>
        </main>
      )}
      {isApp ? <MobileBottomNav /> : null}
    </div>
  );
}

/*
  Route changes fade and lift rather than snapping.

  `mode="wait"` lets the outgoing page finish before the next one starts, which
  keeps two pages from being stacked mid-scroll. The key is the pathname only:
  a query string change is the same page and must not replay the animation.
*/
function RouteTransition({ children }: { children: ReactNode }) {
  const location = useLocation();
  const reduceMotion = useReducedMotion();

  if (reduceMotion) return <>{children}</>;

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={location.pathname}
        variants={pageVariants}
        initial="initial"
        animate="animate"
        exit="exit"
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
