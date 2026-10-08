/**
 * Emergency stop as an office action (SPEC D12, D27; #270).
 *
 *   POST /api/users/:userId/emergency-stop     owner/admin, same origin
 *
 * Office owners and admins no longer see into rooms their own GitHub access
 * does not cover, so they cannot reach a henchman there to stop it. This is
 * the lever they keep: stop every running henchman of one person. Sessions
 * are killed, branches, worktrees and desks stay, each stop is audited (who
 * stopped whose henchman). The answer is two counts and nothing else: no
 * room, no henchman, no task.
 */
import { EMERGENCY_STOP_USER_API_PATH, type EmergencyStopUserResponse } from "@regulus/protocol";
import type { OfficeAuth } from "../../auth/auth.ts";
import { AuthHttpError, forbidden, unauthorized } from "../../auth/errors.ts";
import { checkOrigin } from "../../auth/origin.ts";
import { getProfileByUserId } from "../../auth/roles.ts";
import type { Db } from "../../db/index.ts";
import { json, type Router } from "../../http/router.ts";
import { isOfficeManager } from "../../operations/access.ts";
import { AgentManagerError } from "./errors.ts";
import type { AgentManager } from "./manager.ts";

export function mountEmergencyStopRoutes(
  router: Router,
  deps: {
    auth: Pick<OfficeAuth, "getSessionFromRequest" | "publicUrl" | "allowedOrigins">;
    db: Db;
    agents: Pick<AgentManager, "emergencyStopAllOf">;
  },
): void {
  const { auth, db, agents } = deps;
  router.post(EMERGENCY_STOP_USER_API_PATH, async ({ request, params }) => {
    try {
      const check = checkOrigin(request, auth.publicUrl, { allowedOrigins: auth.allowedOrigins });
      if (!check.ok) throw forbidden("origin_mismatch");
      const user = await auth.getSessionFromRequest(request);
      if (!user) throw unauthorized();
      if (!isOfficeManager(user.role)) throw forbidden("owner_or_admin_required");
      const userId = params.userId ?? "";
      if (!getProfileByUserId(db, userId)) throw new AuthHttpError(404, "user_not_found");
      const body: EmergencyStopUserResponse = await agents.emergencyStopAllOf(
        { id: user.id, role: user.role },
        userId,
      );
      return json(body);
    } catch (err) {
      if (err instanceof AuthHttpError) return err.toResponse();
      if (err instanceof AgentManagerError)
        return forbidden("owner_or_admin_required").toResponse();
      throw err;
    }
  });
}
