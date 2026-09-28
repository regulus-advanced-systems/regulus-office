/**
 * Who is signed in (SPEC §4.2 Auth). Backed by the server's `GET /api/me`,
 * which resolves the httpOnly Better Auth session cookie to the office
 * profile. Nothing secret is ever held here or in localStorage (SPEC §8):
 * the cookie stays with the browser and this store only keeps id, display
 * name and role.
 */
// Enums only: the package index also pulls zod and the Colyseus schemas into the bundle.
import { isUserRole, type UserRole } from "@regulus/protocol/src/enums.ts";
import { create } from "zustand";

export interface SessionUser {
  id: string;
  displayName: string;
  role: UserRole;
}

/**
 * `unknown` before the first check, `loading` while the first check (or a
 * check after sign-out) runs. A refresh while `authenticated` keeps that
 * status so guarded pages stay mounted.
 */
export type SessionStatus = "unknown" | "loading" | "anonymous" | "authenticated" | "error";

export interface SessionStore {
  status: SessionStatus;
  user: SessionUser | null;
  error: string | null;
  /** Ask the server who the cookie belongs to. Concurrent calls share one request. */
  fetchSession: (fetchFn?: typeof fetch) => Promise<void>;
  /** Forget the user locally (after sign-out). */
  clear: () => void;
}

export const SESSION_ENDPOINT = "/api/me";

/** Validate the `/api/me` body (`{ id, displayName, role }`); null if it is not one. */
export function parseSessionUser(body: unknown): SessionUser | null {
  if (!body || typeof body !== "object") return null;
  const { id, displayName, role } = body as Record<string, unknown>;
  if (typeof id !== "string" || id.length === 0) return null;
  return {
    id,
    displayName: typeof displayName === "string" && displayName.length > 0 ? displayName : id,
    // An unknown role gets the least privilege; the server authorises everything anyway.
    role: isUserRole(role) ? role : "viewer",
  };
}

let inflight: Promise<void> | null = null;

export const useSessionStore = create<SessionStore>()((set, get) => ({
  status: "unknown",
  user: null,
  error: null,
  clear: () => set({ status: "anonymous", user: null, error: null }),
  fetchSession: (fetchFn = fetch) => {
    if (inflight) return inflight;
    /** A failed refresh (network, 5xx) keeps a known user; only a 401 signs them out here. */
    const fail = (error: string) =>
      set(get().status === "authenticated" ? { error } : { status: "error", user: null, error });
    const run = async () => {
      if (get().status !== "authenticated") set({ status: "loading", error: null });
      try {
        const res = await fetchFn(SESSION_ENDPOINT, {
          credentials: "same-origin",
          headers: { accept: "application/json" },
        });
        if (res.status === 401) {
          set({ status: "anonymous", user: null, error: null });
          return;
        }
        if (!res.ok) {
          fail(`session check failed (${res.status})`);
          return;
        }
        const user = parseSessionUser(await res.json());
        if (user) set({ status: "authenticated", user, error: null });
        else fail("unexpected session response");
      } catch (err) {
        fail(err instanceof Error ? err.message : String(err));
      }
    };
    inflight = run().finally(() => {
      inflight = null;
    });
    return inflight;
  },
}));

/** Owners and admins manage the office (invites, roles); SPEC §2, §8 rule 4. */
export const canManageOffice = (role: UserRole | undefined): boolean =>
  role === "owner" || role === "admin";
