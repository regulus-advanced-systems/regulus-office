/**
 * Route guard for pages that need a signed-in human (SPEC §4.2 Auth, §11).
 * Children, and with them the Colyseus join in OfficePage, only mount once
 * `/api/me` has confirmed the session; anonymous visitors go to /login.
 */
import { type ReactNode, useEffect } from "react";
import { Navigate, useLocation } from "react-router";
import { useSessionStore } from "../../state/session.ts";
import { Button } from "../components/Button.tsx";
import { ROUTE_PATHS } from "../routes.ts";
import { AuthCard, FormAlert } from "./AuthCard.tsx";
import { useAuthDeps } from "./context.tsx";

export function RequireSession({ children }: { children: ReactNode }) {
  const status = useSessionStore((s) => s.status);
  const error = useSessionStore((s) => s.error);
  const { fetch: fetchFn } = useAuthDeps();
  const location = useLocation();

  useEffect(() => {
    if (useSessionStore.getState().status === "unknown")
      void useSessionStore.getState().fetchSession(fetchFn);
  }, [fetchFn]);

  if (status === "authenticated") return <>{children}</>;
  if (status === "anonymous")
    return <Navigate to={ROUTE_PATHS.login} replace state={{ from: location.pathname }} />;
  if (status === "error")
    return (
      <AuthCard title="Can't reach the office">
        <FormAlert>Checking your session failed{error ? `: ${error}` : ""}.</FormAlert>
        <Button
          variant="primary"
          block
          onClick={() => void useSessionStore.getState().fetchSession(fetchFn)}
        >
          Try again
        </Button>
      </AuthCard>
    );
  return (
    <main className="centered" aria-busy="true">
      Checking your session…
    </main>
  );
}
