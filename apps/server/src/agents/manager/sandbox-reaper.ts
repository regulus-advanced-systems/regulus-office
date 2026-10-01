/**
 * Reaping orphaned henchman sandboxes (D18, #169). Stop, send-home and failed
 * starts remove a henchman's sandbox at once (`Runner.kill`). What is left over
 * is reaped here, at boot (after re-adoption) and then every minute:
 * - sandboxes of henchmen the office no longer tracks (sent home while exited,
 *   deleted with their operation, or rows gone while the office was down);
 * - sandboxes of henchmen that have been down (exited on their own, offline,
 *   failed) for a while; the dev servers they started go with them.
 *
 * The grace period keeps a sandbox that is being made or re-used by a start
 * or a resume from being reaped under it.
 */
import type { AgentStatus } from "@regulus/protocol";
import type { Logger } from "../../logging.ts";
import type { Runner } from "../../runners/types.ts";
import { WORKFLOW_RUNNER_USER } from "../../workflows/workspace.ts";

export const SANDBOX_REAP_INTERVAL_MS = 60_000;
export const SANDBOX_REAP_GRACE_MS = 120_000;

const DOWN: readonly AgentStatus[] = ["exited", "offline", "error"];

export interface ReapDeps {
  runner: Runner;
  logger: Logger;
  /** The office's clock (status times). */
  now: () => number;
  /** A tracked henchman's status and when it last changed; undefined when not tracked. */
  view(agentId: string): { status: AgentStatus; lastActivityAt: number } | undefined;
}

/** Remove orphaned sandboxes; returns how many were removed. */
export async function reapSandboxes(
  deps: ReapDeps,
  graceMs = SANDBOX_REAP_GRACE_MS,
): Promise<number> {
  if (!deps.runner.listSandboxes) return 0;
  let removed = 0;
  for (const sb of await deps.runner.listSandboxes()) {
    // Workflow henchmen (#155) are not agents; the workflow engine removes their sandboxes.
    if (sb.userId === WORKFLOW_RUNNER_USER) continue;
    // Creation time comes from the backend's (wall) clock.
    if (sb.createdAt !== undefined && Date.now() - sb.createdAt < graceMs) continue;
    const view = deps.view(sb.agentId);
    if (view && !(DOWN.includes(view.status) && deps.now() - view.lastActivityAt >= graceMs)) {
      continue;
    }
    try {
      await deps.runner.kill({ userId: sb.userId, agentId: sb.agentId });
      removed++;
      deps.logger.info(
        { agentId: sb.agentId, status: view?.status ?? "untracked" },
        "orphaned agent sandbox removed",
      );
    } catch (err) {
      deps.logger.warn({ agentId: sb.agentId, err: String(err) }, "sandbox could not be reaped");
    }
  }
  return removed;
}
