/**
 * Who may do what on a floor (SPEC §5 `floor_members`, §8 rule 4, §11).
 *
 * - Office owners and admins implicitly `manage` every floor.
 * - Everyone else gets the access stored in `floor_members`, or none.
 * - Office `viewer`s are capped at `view` whatever their row says.
 * - Archived or unknown floors grant nothing (the lobby is not a floor row).
 */
import type { FloorAccess, UserRole } from "@regulus/protocol";
import { and, eq, isNull } from "drizzle-orm";
import type { DbOrTx } from "../auth/audit.ts";
import { floorMembers, floors } from "../db/schema/index.ts";

export interface FloorActor {
  id: string;
  role: UserRole;
}

export const isOfficeManager = (role: UserRole): boolean => role === "owner" || role === "admin";

/** Apply the office-role rules to a stored membership. */
export function effectiveAccess(role: UserRole, stored: FloorAccess | null): FloorAccess | null {
  if (isOfficeManager(role)) return "manage";
  if (!stored) return null;
  if (role === "viewer") return "view";
  return stored;
}

/** The actor's access to a live (non-archived) floor, or null. */
export function floorAccessFor(db: DbOrTx, actor: FloorActor, floorId: string): FloorAccess | null {
  const row = db
    .select({ id: floors.id, access: floorMembers.access })
    .from(floors)
    .leftJoin(
      floorMembers,
      and(eq(floorMembers.floorId, floors.id), eq(floorMembers.userId, actor.id)),
    )
    .where(and(eq(floors.id, floorId), isNull(floors.archivedAt)))
    .get();
  if (!row) return null;
  return effectiveAccess(actor.role, row.access ?? null);
}
