/**
 * The office's people, for the floor members panel (SPEC §2 roles, §5
 * `floor_members`, §11). Only someone who can manage at least one live floor
 * needs to pick people to grant, so only they may list them: owners and
 * admins always, members with a `manage` row, never viewers (capped at
 * `view`). Emails are office-admin information and go to owners and admins
 * only.
 */
import type { OfficeUserInfo } from "@regulus/protocol";
import { and, asc, eq, isNull } from "drizzle-orm";
import type { DbOrTx } from "../auth/audit.ts";
import { forbidden } from "../auth/errors.ts";
import { floorMembers, floors, userProfiles, users } from "../db/schema/index.ts";
import { effectiveAccess, type FloorActor, isOfficeManager } from "./access.ts";

/** True when the actor has effective `manage` on at least one live floor (or is owner/admin). */
export function managesAnyFloor(db: DbOrTx, actor: FloorActor): boolean {
  if (isOfficeManager(actor.role)) return true;
  const row = db
    .select({ id: floorMembers.id })
    .from(floorMembers)
    .innerJoin(floors, eq(floors.id, floorMembers.floorId))
    .where(
      and(
        eq(floorMembers.userId, actor.id),
        eq(floorMembers.access, "manage"),
        isNull(floors.archivedAt),
      ),
    )
    .get();
  return row !== undefined && effectiveAccess(actor.role, "manage") === "manage";
}

/** Everyone in the office by display name; 403 unless the actor manages a floor. */
export function listOfficeUsers(db: DbOrTx, actor: FloorActor): OfficeUserInfo[] {
  if (!managesAnyFloor(db, actor)) throw forbidden("floor_manage_required");
  const withEmail = isOfficeManager(actor.role);
  const rows = db
    .select({
      userId: userProfiles.userId,
      displayName: userProfiles.displayName,
      role: userProfiles.role,
      email: users.email,
    })
    .from(userProfiles)
    .innerJoin(users, eq(users.id, userProfiles.userId))
    .orderBy(asc(userProfiles.displayName))
    .all();
  return rows.map(({ email, ...rest }) => (withEmail ? { ...rest, email } : rest));
}
