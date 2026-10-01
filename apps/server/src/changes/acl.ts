/**
 * Who may use a henchman's changes window (#38), the terminal's audience and
 * rule (SPEC §8 rule 4, D12):
 *
 * - Anyone who can see the henchman's operation may view: the file list, diffs and
 *   image previews, read-only. Office owners, admins and viewers included.
 * - Commit and discard are control: the henchman's owner only, never a viewer
 *   (`mayControlHenchman`). Office owners and admins are refused like anyone else.
 * - Someone who cannot see the operation learns nothing: the henchman is 404.
 */
import { mayControlHenchman, type UserRole } from "@regulus/protocol";

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
  henchman: { ownerUserId: string; operationId: string },
  want: ChangesAccess,
  canViewOperation: (user: ChangesUser, operationId: string) => boolean,
): ChangesDecision {
  if (!canViewOperation(user, henchman.operationId))
    return { ok: false, status: 404, code: "not_found" };
  if (want === "view" || mayControlHenchman(user, henchman.ownerUserId)) return { ok: true };
  return { ok: false, status: 403, code: "owner_only" };
}

/** Whether the caller gets the commit and discard controls (the UI hint; routes check again). */
export function mayWriteChanges(user: ChangesUser, ownerUserId: string): boolean {
  return mayControlHenchman(user, ownerUserId);
}
