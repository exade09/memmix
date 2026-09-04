import { Navigate, Route, Routes } from "react-router-dom";
import { appConfig } from "./config";
import { ComingSoonGate } from "../components/layout/ComingSoonGate";
import { PageShell } from "../components/layout/PageShell";
import { CaAdminPage } from "../routes/admin/CaAdminPage";
import { DocsPage } from "../routes/docs/DocsPage";
import { ExplorePage } from "../routes/explore/ExplorePage";
import { LandingPage } from "../routes/landing/LandingPage";
import { LaunchPage } from "../routes/launch/LaunchPage";
import { LegalHubPage, NotFoundPage, PrivacyPage, TermsPage } from "../routes/legal/LegalPages";
import { MixPage } from "../routes/mix/MixPage";
import { TokenPage } from "../routes/token/TokenPage";
import { LaunchSuccessPage } from "../routes/token/LaunchSuccessPage";

export function AppRouter() {
  if (appConfig.siteGateEnabled) {
    return (
      <Routes>
        <Route path="/admin/ca" element={<CaAdminPage />} />
        <Route path="*" element={<ComingSoonGate />} />
      </Routes>
    );
  }
  return (
    <Routes>
      <Route element={<PageShell />}>
        <Route path="/" element={<LandingPage />} />
        <Route path="/app" element={<Navigate to="/app/mix" replace />} />
        <Route path="/app/mix" element={<MixPage />} />
        <Route path="/app/launch" element={<LaunchPage />} />
        <Route path="/app/launch/success" element={<LaunchSuccessPage />} />
        <Route path="/app/explore" element={<ExplorePage />} />
        <Route path="/token/:mint" element={<TokenPage />} />
        <Route path="/docs" element={<DocsPage />} />
        <Route path="/admin/ca" element={<CaAdminPage />} />
        <Route path="/legal" element={<LegalHubPage />} />
        <Route path="/terms" element={<TermsPage />} />
        <Route path="/privacy" element={<PrivacyPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
