/**
 * The office's people, for the operation members panel (SPEC §2 roles, §5
 * `operation_members`, §11). Only someone who can manage at least one live operation
 * needs to pick people, so only they may list them: office owners and
 * admins always (people are theirs to manage), others when their GitHub
 * permission lets them manage a room, never viewers (capped at `view`).
 * Emails are office-admin information and go to owners and admins only.
 */
import type { OfficeUserInfo } from "@regulus/protocol";
import { asc, eq } from "drizzle-orm";
import type { DbOrTx } from "../auth/audit.ts";
import { forbidden } from "../auth/errors.ts";
import { userProfiles, users } from "../db/schema/index.ts";
import { accessibleOperations, isOfficeManager, type OperationActor } from "./access.ts";

/** True when the actor has `manage` on at least one live operation (or is owner/admin). */
export function managesAnyOperation(db: DbOrTx, actor: OperationActor): boolean {
  if (isOfficeManager(actor.role)) return true;
  for (const access of accessibleOperations(db, actor).values()) {
    if (access === "manage") return true;
  }
  return false;
}

/** Everyone in the office by display name; 403 unless the actor manages an operation. */
export function listOfficeUsers(db: DbOrTx, actor: OperationActor): OfficeUserInfo[] {
  if (!managesAnyOperation(db, actor)) throw forbidden("operation_manage_required");
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
