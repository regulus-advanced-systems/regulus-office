/**
 * Who may open a robot's app (#39), in the spirit of D12 (SPEC §8 rule 4):
 *
 * - The floor must be visible to the user (floors/access.ts), else the app
 *   does not exist for them (404), as for terminals.
 * - The robot's owner gets full access ("control"): every method and
 *   WebSocket messages both ways. The app runs in their robot's sandbox with
 *   their CLI logins in HOME; driving it is driving their robot's environment.
 * - Everyone else with floor access (members, viewers, admins, the office
 *   owner) may "watch": GET/HEAD only, and WebSocket frames from the app to
 *   the browser only (HMR keeps working, nothing goes back). Like watching a
 *   terminal: they see the app, they cannot act inside another human's sandbox.
 * - Watching is offered only in app domain mode. On the office's own origin
 *   the app's scripts would run with the viewer's office session, so a robot
 *   (or a dependency it installed) could act as the viewer in the office.
 *   Without `OFFICE_SERVICES_DOMAIN` only the owner opens their robot's apps.
 */
import { mayControlRobot, type UserRole } from "@regulus/protocol";

export type AppAccess = "control" | "watch";

export interface AppUser {
  id: string;
  role: UserRole;
}

export type AppDecision =
  | { ok: true; access: AppAccess }
  | { ok: false; status: 404 | 403; reason: "not_found" | "owner_only" };

export function decideAppAccess(
  user: AppUser,
  app: { ownerUserId: string; floorId: string },
  canViewFloor: (user: AppUser, floorId: string) => boolean,
  isolatedOrigin: boolean,
): AppDecision {
  if (!canViewFloor(user, app.floorId)) return { ok: false, status: 404, reason: "not_found" };
  if (mayControlRobot(user, app.ownerUserId)) return { ok: true, access: "control" };
  if (isolatedOrigin) return { ok: true, access: "watch" };
  return { ok: false, status: 403, reason: "owner_only" };
}

/** Methods a watcher may use. */
export const WATCH_METHODS: ReadonlySet<string> = new Set(["GET", "HEAD"]);

export function methodAllowed(access: AppAccess, method: string): boolean {
  return access === "control" || WATCH_METHODS.has(method.toUpperCase());
}
