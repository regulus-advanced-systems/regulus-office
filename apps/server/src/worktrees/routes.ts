/**
 * REST for worktree maintenance (owner/admin only, same-origin writes):
 *
 *   POST /api/worktrees/prune   remove orphaned agent worktrees, `git worktree prune`
 */

import { AUDIT_ACTIONS, writeAudit } from "../auth/audit.ts";
import type { OfficeAuth } from "../auth/auth.ts";
import { AuthHttpError, forbidden, unauthorized } from "../auth/errors.ts";
import { checkOrigin } from "../auth/origin.ts";
import type { Db } from "../db/index.ts";
import { json, type Router } from "../http/router.ts";
import { isOfficeManager } from "../operations/access.ts";
import type { PruneResult } from "./prune.ts";

export const WORKTREES_PRUNE_PATH = "/api/worktrees/prune";

export function mountWorktreeRoutes(
  router: Router,
  deps: {
    auth: Pick<OfficeAuth, "getSessionFromRequest" | "publicUrl" | "allowedOrigins">;
    db: Db;
    prune(): Promise<PruneResult>;
  },
): void {
  const { auth } = deps;
  router.post(WORKTREES_PRUNE_PATH, async ({ request }) => {
    try {
      const check = checkOrigin(request, auth.publicUrl, { allowedOrigins: auth.allowedOrigins });
      if (!check.ok) throw forbidden("origin_mismatch");
      const user = await auth.getSessionFromRequest(request);
      if (!user) throw unauthorized();
      if (!isOfficeManager(user.role)) throw forbidden("owner_or_admin_required");
      const result = await deps.prune();
      writeAudit(deps.db, {
        userId: user.id,
        action: AUDIT_ACTIONS.worktreesPrune,
        targetKind: "worktrees",
        targetId: null,
        meta: { removed: result.removed.length, failed: result.failed.length, repos: result.repos },
      });
      // Counts only: a path names the room's directory, and the office role does
      // not show a room of a repo the person cannot see (D27; #270).
      return json({
        removed: result.removed.length,
        failed: result.failed.length,
        repos: result.repos,
      });
    } catch (err) {
      if (err instanceof AuthHttpError) return err.toResponse();
      throw err;
    }
  });
}
