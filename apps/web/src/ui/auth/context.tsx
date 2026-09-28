/**
 * Dependency seam for the auth UI: the API client and the fetch the session
 * store uses. Production uses the page's own fetch; tests provide a fake.
 */
import { createContext, type ReactNode, useCallback, useContext } from "react";
import { useNavigate } from "react-router";
import { useSessionStore } from "../../state/session.ts";
import { ROUTE_PATHS } from "../routes.ts";
import { type AuthApi, authApi, createAuthApi } from "./api.ts";

export interface AuthDeps {
  api: AuthApi;
  fetch: typeof fetch;
}

const defaultDeps: AuthDeps = {
  api: authApi,
  fetch: ((input, init) => fetch(input, init)) as typeof fetch,
};

const AuthDepsContext = createContext<AuthDeps>(defaultDeps);

export function AuthProvider({
  fetch: fetchFn,
  children,
}: {
  fetch: typeof fetch;
  children: ReactNode;
}) {
  return (
    <AuthDepsContext.Provider value={{ api: createAuthApi({ fetch: fetchFn }), fetch: fetchFn }}>
      {children}
    </AuthDepsContext.Provider>
  );
}

export const useAuthDeps = (): AuthDeps => useContext(AuthDepsContext);

/** Re-read the session after the server set the cookie, then enter the office. */
export function useCompleteSignIn(): () => Promise<boolean> {
  const { fetch: fetchFn } = useAuthDeps();
  const navigate = useNavigate();
  return useCallback(async () => {
    await useSessionStore.getState().fetchSession(fetchFn);
    if (useSessionStore.getState().status !== "authenticated") return false;
    navigate(ROUTE_PATHS.office, { replace: true });
    return true;
  }, [fetchFn, navigate]);
}

/** Sign out on the server, forget the user; the route guard then sends the page to /login. */
export function useSignOut(): () => Promise<void> {
  const { api } = useAuthDeps();
  return useCallback(async () => {
    await api.signOut();
    useSessionStore.getState().clear();
  }, [api]);
}
