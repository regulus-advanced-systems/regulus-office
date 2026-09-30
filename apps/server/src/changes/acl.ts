/**
 * Who may use a robot's changes window (#38), the terminal's audience and
 * rule (SPEC §8 rule 4, D12):
 *
 * - Anyone who can see the robot's floor may view: the file list, diffs and
 *   image previews, read-only. Office owners, admins and viewers included.
 * - Commit and discard are control: the robot's owner only, never a viewer
 *   (`mayControlRobot`). Office owners and admins are refused like anyone else.
 * - Someone who cannot see the floor learns nothing: the robot is 404.
 */
import { mayControlRobot, type UserRole } from "@regulus/protocol";

export interface ChangesUser {
  id: string;
  role: UserRole;
}

export type ChangesAccess = "view" | "write";

export type ChangesDecision =
  | { ok: true }
  | { ok: false; status: 404 | 403; code: "not_found" | "owner_only" };

export function decideChangesAccess(
  user: ChangesUser,
  robot: { ownerUserId: string; floorId: string },
  want: ChangesAccess,
  canViewFloor: (user: ChangesUser, floorId: string) => boolean,
): ChangesDecision {
  if (!canViewFloor(user, robot.floorId)) return { ok: false, status: 404, code: "not_found" };
  if (want === "view" || mayControlRobot(user, robot.ownerUserId)) return { ok: true };
  return { ok: false, status: 403, code: "owner_only" };
}

/** Whether the caller gets the commit and discard controls (the UI hint; routes check again). */
export function mayWriteChanges(user: ChangesUser, ownerUserId: string): boolean {
  return mayControlRobot(user, ownerUserId);
}
