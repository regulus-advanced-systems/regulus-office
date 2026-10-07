/**
 * Terminal ACL (SPEC §8 rule 4, §14 D12), checked on every connection:
 *
 * - Anyone who can view the henchman's operation may watch its terminal.
 * - Control (typing, approving in the TUI, resizing) is the henchman's owner's
 *   alone (#138); office `admin`s/`owner`s watch other people's henchmen like
 *   everyone else (their only lever is the OperationRoom `agent.emergencyStop`).
 * - `viewer`s watch only, even their own henchmen.
 *
 * "Can view the operation" is any access from operations/access.ts (owners/admins see
 * every live operation, others need an `operation_members` row, archived operations are
 * invisible), so the terminal and the OperationRoom agree on who sees a henchman.
 */
import { mayControlHenchman, type TerminalMode, type UserRole } from "@regulus/protocol";
import type { Db } from "../db/index.ts";
import { operationAccessFor } from "../operations/access.ts";

export interface TerminalUser {
  id: string;
  role: UserRole;
  /** Shown to the other viewers (faces, "X is typing"); the id is used when absent. */
  displayName?: string;
  /** The Better Auth session behind the request (live access, #244). */
  sessionId?: string;
}

/** Whether `user` may see operation `operationId` at all. */
export type OperationVisibility = (user: TerminalUser, operationId: string) => boolean;

export type TerminalDecision =
  | { ok: true }
  /** `not_found`: the operation is invisible to the user, so the henchman's existence is not revealed. */
  | { ok: false; reason: "not_found" | "forbidden" };

/** Whether `user` may take `mode` on a henchman owned by `ownerUserId` on an operation they can see. */
export function mayUseTerminal(
  user: TerminalUser,
  ownerUserId: string,
  mode: TerminalMode,
): boolean {
  if (mode === "watch") return true;
  return mayControlHenchman(user, ownerUserId);
}

export function decideTerminalAccess(
  user: TerminalUser,
  target: { ownerUserId: string; operationId: string },
  mode: TerminalMode,
  canViewOperation: OperationVisibility,
): TerminalDecision {
  if (!canViewOperation(user, target.operationId)) return { ok: false, reason: "not_found" };
  return mayUseTerminal(user, target.ownerUserId, mode)
    ? { ok: true }
    : { ok: false, reason: "forbidden" };
}

/** Operation visibility from `operations` + `operation_members` via operations/access.ts. */
export function dbOperationVisibility(db: Db): OperationVisibility {
  return (user, operationId) => operationAccessFor(db, user, operationId) !== null;
}
