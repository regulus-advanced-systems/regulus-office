/**
 * Terminal ACL (SPEC §8 rule 4, §14 D12), checked on every connection:
 *
 * - Anyone who can view the robot's floor may watch its terminal.
 * - Control (typing, approving in the TUI) requires being the robot's owner
 *   or an office `admin`/`owner`.
 * - `viewer`s watch only, even their own robots.
 *
 * Floor visibility follows the rules #30 introduces in floors/access.ts
 * (owners/admins see every live floor, others need a `floor_members` row,
 * archived floors are invisible); {@link dbFloorVisibility} mirrors them
 * until that module lands and can then be swapped for `floorAccessFor`.
 */
import type { TerminalMode, UserRole } from "@regulus/protocol";
import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { floorMembers, floors } from "../db/schema/index.ts";

export interface TerminalUser {
  id: string;
  role: UserRole;
}

/** Whether `user` may see floor `floorId` at all. */
export type FloorVisibility = (user: TerminalUser, floorId: string) => boolean;

export type TerminalDecision =
  | { ok: true }
  /** `not_found`: the floor is invisible to the user, so the robot's existence is not revealed. */
  | { ok: false; reason: "not_found" | "forbidden" };

const isOfficeManager = (role: UserRole): boolean => role === "owner" || role === "admin";

/** Whether `user` may take `mode` on a robot owned by `ownerUserId` on a floor they can see. */
export function mayUseTerminal(
  user: TerminalUser,
  ownerUserId: string,
  mode: TerminalMode,
): boolean {
  if (mode === "watch") return true;
  if (isOfficeManager(user.role)) return true;
  return user.role !== "viewer" && user.id === ownerUserId;
}

export function decideTerminalAccess(
  user: TerminalUser,
  target: { ownerUserId: string; floorId: string },
  mode: TerminalMode,
  canViewFloor: FloorVisibility,
): TerminalDecision {
  if (!canViewFloor(user, target.floorId)) return { ok: false, reason: "not_found" };
  return mayUseTerminal(user, target.ownerUserId, mode)
    ? { ok: true }
    : { ok: false, reason: "forbidden" };
}

/** Floor visibility from `floors` + `floor_members` (same rules as #30's floors/access.ts). */
export function dbFloorVisibility(db: Db): FloorVisibility {
  return (user, floorId) => {
    const row = db
      .select({ id: floors.id, access: floorMembers.access })
      .from(floors)
      .leftJoin(
        floorMembers,
        and(eq(floorMembers.floorId, floors.id), eq(floorMembers.userId, user.id)),
      )
      .where(and(eq(floors.id, floorId), isNull(floors.archivedAt)))
      .get();
    if (!row) return false;
    return isOfficeManager(user.role) || row.access !== null;
  };
}
