/**
 * Who may do what on an operation (SPEC §5 `operation_members`, §8 rule 4, §11).
 *
 * - Office owners and admins implicitly `manage` every operation.
 * - Everyone else gets the access stored in `operation_members`, or none.
 * - Office `viewer`s are capped at `view` whatever their row says.
 * - Archived or unknown operations grant nothing (the lobby is not an operation row).
 */
import type { OperationAccess, UserRole } from "@regulus/protocol";
import { and, eq, isNull } from "drizzle-orm";
import type { DbOrTx } from "../auth/audit.ts";
import { operationMembers, operations } from "../db/schema/index.ts";

export interface OperationActor {
  id: string;
  role: UserRole;
}

export const isOfficeManager = (role: UserRole): boolean => role === "owner" || role === "admin";

/** Apply the office-role rules to a stored membership. */
export function effectiveAccess(
  role: UserRole,
  stored: OperationAccess | null,
): OperationAccess | null {
  if (isOfficeManager(role)) return "manage";
  if (!stored) return null;
  if (role === "viewer") return "view";
  return stored;
}

/** The actor's access to a live (non-archived) operation, or null. */
export function operationAccessFor(
  db: DbOrTx,
  actor: OperationActor,
  operationId: string,
): OperationAccess | null {
  const row = db
    .select({ id: operations.id, access: operationMembers.access })
    .from(operations)
    .leftJoin(
      operationMembers,
      and(eq(operationMembers.operationId, operations.id), eq(operationMembers.userId, actor.id)),
    )
    .where(and(eq(operations.id, operationId), isNull(operations.archivedAt)))
    .get();
  if (!row) return null;
  return effectiveAccess(actor.role, row.access ?? null);
}
