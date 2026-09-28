import { lazy, Suspense, useEffect } from "react";
import { createBrowserRouter, Navigate, RouterProvider } from "react-router";
import { watchReducedMotion } from "../state/ui.ts";
import { InviteDialogHost } from "./auth/InviteDialog.tsx";
import { RequireSession } from "./auth/RequireSession.tsx";
import { JoinPage } from "./pages/JoinPage.tsx";
import { LoginPage } from "./pages/LoginPage.tsx";
import { ROUTE_PATHS } from "./routes.ts";
import { themeCssText } from "./theme.ts";

/** The office pulls in three.js; load it only on /office so /login and /join stay light. */
const OfficePage = lazy(() =>
  import("./pages/OfficePage.tsx").then((m) => ({ default: m.OfficePage })),
);
const UiKitPage = lazy(() =>
  import("./pages/UiKitPage.tsx").then((m) => ({ default: m.UiKitPage })),
);

const router = createBrowserRouter([
  { path: ROUTE_PATHS.home, element: <Navigate to={ROUTE_PATHS.office} replace /> },
  { path: ROUTE_PATHS.login, Component: LoginPage },
  { path: ROUTE_PATHS.join, Component: JoinPage },
  {
    path: ROUTE_PATHS.office,
    // The guard holds the office (and its room join) back until /api/me confirms the session.
    element: (
      <RequireSession>
        <Suspense fallback={<main className="centered">Loading the office…</main>}>
          <OfficePage />
        </Suspense>
        <InviteDialogHost />
      </RequireSession>
    ),
  },
  {
    path: ROUTE_PATHS.uiKit,
    element: (
      <Suspense fallback={<main className="centered">Loading the UI kit…</main>}>
        <UiKitPage />
      </Suspense>
    ),
  },
  { path: "*", element: <Navigate to={ROUTE_PATHS.office} replace /> },
]);

/** Design tokens as CSS custom properties (SPEC §12), generated from theme.ts. */
const THEME_CSS = themeCssText();

export function App() {
  useEffect(() => watchReducedMotion(), []);
  return (
    <>
      <style id="rg-theme">{THEME_CSS}</style>
      <RouterProvider router={router} />
    </>
  );
}
