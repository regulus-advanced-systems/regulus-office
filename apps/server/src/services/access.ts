/**
 * Who may open a henchman's app (#39), in the spirit of D12 (SPEC §8 rule 4):
 *
 * - The operation must be visible to the user (operations/access.ts), else the app
 *   does not exist for them (404), as for terminals.
 * - The henchman's owner gets full access ("control"): every method and
 *   WebSocket messages both ways. The app runs in their henchman's sandbox with
 *   their CLI logins in HOME; driving it is driving their henchman's environment.
 * - Everyone else with operation access (members, viewers, admins, the office
 *   owner) may "watch": GET/HEAD only, and WebSocket frames from the app to
 *   the browser only (HMR keeps working, nothing goes back). Like watching a
 *   terminal: they see the app, they cannot act inside another human's sandbox.
 * - Watching is offered only in app domain mode. On the office's own origin
 *   the app's scripts would run with the viewer's office session, so a henchman
 *   (or a dependency it installed) could act as the viewer in the office.
 *   Without `OFFICE_SERVICES_DOMAIN` only the owner opens their henchman's apps.
 */
import { mayControlHenchman, type UserRole } from "@regulus/protocol";

export type AppAccess = "control" | "watch";

export interface AppUser {
  id: string;
  role: UserRole;
  /** The Better Auth session behind an office-origin request (live access, #244). */
  sessionId?: string;
}

export type AppDecision =
  | { ok: true; access: AppAccess }
  | { ok: false; status: 404 | 403; reason: "not_found" | "owner_only" };

export function decideAppAccess(
  user: AppUser,
  app: { ownerUserId: string; operationId: string },
  canViewOperation: (user: AppUser, operationId: string) => boolean,
  isolatedOrigin: boolean,
): AppDecision {
  if (!canViewOperation(user, app.operationId))
    return { ok: false, status: 404, reason: "not_found" };
  if (mayControlHenchman(user, app.ownerUserId)) return { ok: true, access: "control" };
  if (isolatedOrigin) return { ok: true, access: "watch" };
  return { ok: false, status: 403, reason: "owner_only" };
}

/** Methods a watcher may use. */
export const WATCH_METHODS: ReadonlySet<string> = new Set(["GET", "HEAD"]);

export function methodAllowed(access: AppAccess, method: string): boolean {
  return access === "control" || WATCH_METHODS.has(method.toUpperCase());
}
