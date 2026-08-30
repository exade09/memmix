import "./polyfills";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { ErrorBoundary } from "./components/layout/ErrorBoundary";
import { AppRouter } from "./app/router";
import { SolanaProviders } from "./solana/WalletProviders";
import "./styles/base.css";
import "./styles/layout.css";
import "./styles/ui.css";
import "./styles/parts.css";
import "./styles/mascot.css";
import "./styles/landing.css";
import "./styles/app.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <SolanaProviders>
      <ErrorBoundary>
        <BrowserRouter>
          <AppRouter />
        </BrowserRouter>
      </ErrorBoundary>
    </SolanaProviders>
  </StrictMode>,
);
