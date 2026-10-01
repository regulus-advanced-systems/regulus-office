/**
 * The office's people, for the operation members panel (SPEC §2 roles, §5
 * `operation_members`, §11). Only someone who can manage at least one live operation
 * needs to pick people to grant, so only they may list them: owners and
 * admins always, members with a `manage` row, never viewers (capped at
 * `view`). Emails are office-admin information and go to owners and admins
 * only.
 */
import type { OfficeUserInfo } from "@regulus/protocol";
import { and, asc, eq, isNull } from "drizzle-orm";
import type { DbOrTx } from "../auth/audit.ts";
import { forbidden } from "../auth/errors.ts";
import { operationMembers, operations, userProfiles, users } from "../db/schema/index.ts";
import { effectiveAccess, isOfficeManager, type OperationActor } from "./access.ts";

/** True when the actor has effective `manage` on at least one live operation (or is owner/admin). */
export function managesAnyOperation(db: DbOrTx, actor: OperationActor): boolean {
  if (isOfficeManager(actor.role)) return true;
  const row = db
    .select({ id: operationMembers.id })
    .from(operationMembers)
    .innerJoin(operations, eq(operations.id, operationMembers.operationId))
    .where(
      and(
        eq(operationMembers.userId, actor.id),
        eq(operationMembers.access, "manage"),
        isNull(operations.archivedAt),
      ),
    )
    .get();
  return row !== undefined && effectiveAccess(actor.role, "manage") === "manage";
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
