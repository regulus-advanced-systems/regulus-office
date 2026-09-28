import { lazy, Suspense } from "react";
import { createBrowserRouter, Navigate, RouterProvider } from "react-router";
import { JoinPage } from "./pages/JoinPage.tsx";
import { LoginPage } from "./pages/LoginPage.tsx";
import { ROUTE_PATHS } from "./routes.ts";

/** The office pulls in three.js; load it only on /office so /login and /join stay light. */
const OfficePage = lazy(() =>
  import("./pages/OfficePage.tsx").then((m) => ({ default: m.OfficePage })),
);

const router = createBrowserRouter([
  { path: ROUTE_PATHS.home, element: <Navigate to={ROUTE_PATHS.office} replace /> },
  { path: ROUTE_PATHS.login, Component: LoginPage },
  { path: ROUTE_PATHS.join, Component: JoinPage },
  {
    path: ROUTE_PATHS.office,
    element: (
      <Suspense fallback={<main className="centered">Loading the office…</main>}>
        <OfficePage />
      </Suspense>
    ),
  },
  { path: "*", element: <Navigate to={ROUTE_PATHS.office} replace /> },
]);

export function App() {
  return <RouterProvider router={router} />;
}
