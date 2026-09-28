/**
 * Auth session placeholder. Real auth (Better Auth, invites) is issue #11;
 * this store only asks `/api/auth/session` and tolerates the endpoint not
 * existing yet. No tokens are ever stored here (SPEC §8): the session cookie
 * stays with the browser.
 */
import { isUserRole, type UserRole } from "@regulus/protocol";
import { create } from "zustand";

export interface SessionUser {
  id: string;
  displayName: string;
  role: UserRole;
}

export type SessionStatus = "unknown" | "loading" | "anonymous" | "authenticated" | "error";

export interface SessionStore {
  status: SessionStatus;
  user: SessionUser | null;
  error: string | null;
  fetchSession: (fetchFn?: typeof fetch) => Promise<void>;
  clear: () => void;
}

export const SESSION_ENDPOINT = "/api/auth/session";

/** Pick a `SessionUser` out of whatever the auth endpoint returned, or null. */
export function parseSessionUser(body: unknown): SessionUser | null {
  if (!body || typeof body !== "object") return null;
  const user = (body as { user?: unknown }).user;
  if (!user || typeof user !== "object") return null;
  const { id, displayName, name, role } = user as Record<string, unknown>;
  if (typeof id !== "string" || id.length === 0) return null;
  const shownName = typeof displayName === "string" ? displayName : name;
  return {
    id,
    displayName: typeof shownName === "string" && shownName.length > 0 ? shownName : id,
    role: isUserRole(role) ? role : "viewer",
  };
}

export const useSessionStore = create<SessionStore>()((set) => ({
  status: "unknown",
  user: null,
  error: null,
  clear: () => set({ status: "anonymous", user: null, error: null }),
  fetchSession: async (fetchFn = fetch) => {
    set({ status: "loading", error: null });
    try {
      const res = await fetchFn(SESSION_ENDPOINT, { credentials: "same-origin" });
      if (res.status === 404 || res.status === 401) {
        set({ status: "anonymous", user: null });
        return;
      }
      if (!res.ok) {
        set({ status: "error", user: null, error: `session endpoint returned ${res.status}` });
        return;
      }
      const user = parseSessionUser(await res.json());
      set(user ? { status: "authenticated", user } : { status: "anonymous", user: null });
    } catch (err) {
      set({ status: "error", user: null, error: err instanceof Error ? err.message : String(err) });
    }
  },
}));
