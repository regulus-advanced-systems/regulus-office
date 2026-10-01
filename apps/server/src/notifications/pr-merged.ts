/**
 * "PR merged" notifications (#42) from the GitHub event bus (#35): a
 * `pull_request` `closed` event with the PR merged, from a verified webhook
 * or from polling, notifies the owner of every henchman whose stored PR it is.
 *
 * Henchmen are looked up in the `agents` table, whose rows outlive the live
 * henchman, so a PR merged after its henchman was sent home still notifies its
 * owner. A mark in `notification_marks` makes each merge notify once, even
 * when both a webhook and a poll report it, and across restarts.
 */
import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { agents, userProfiles } from "../db/schema/index.ts";
import type { GitHubEventBus } from "../github/events.ts";
import type { Logger } from "../logging.ts";
import type { NotificationCenter } from "./center.ts";
import type { NotificationDirectory } from "./directory.ts";
import type { HenchmanSnapshot } from "./events.ts";

export const mergedMark = (repoId: string, n: number) => `pr_merged:${repoId}#${n}`;

export interface MergedPullRequestDeps {
  db: Db;
  events: Pick<GitHubEventBus, "on">;
  center: Pick<NotificationCenter, "pullRequestMerged">;
  directory: Pick<NotificationDirectory, "mark">;
  logger: Logger;
}

/** Subscribe; returns the unsubscribe function. */
export function notifyMergedPullRequests(deps: MergedPullRequestDeps): () => void {
  return deps.events.on("pull_request", (event) => {
    if (event.action !== "closed" || event.stale || event.repoIds.length === 0) return;
    const pr = event.payload.pull_request;
    const number = pr?.number;
    const merged =
      pr?.merged === true || (typeof pr?.merged_at === "string" && pr.merged_at !== "");
    if (!merged || typeof number !== "number") return;
    for (const henchman of henchmenWithPull(deps.db, event.repoIds, number)) {
      if (!deps.directory.mark(mergedMark(henchman.repoId, number))) continue;
      deps.logger.info(
        { agentId: henchman.agentId, prNumber: number, source: event.source },
        "henchman PR merged",
      );
      deps.center.pullRequestMerged(henchman);
    }
  });
}

function henchmenWithPull(db: Db, repoIds: string[], prNumber: number): HenchmanSnapshot[] {
  return db
    .select({
      agentId: agents.id,
      operationId: agents.operationId,
      repoId: agents.repoId,
      ownerUserId: agents.ownerUserId,
      ownerName: userProfiles.displayName,
      provider: agents.provider,
      status: agents.status,
      taskTitle: agents.taskTitle,
      prNumber: agents.prNumber,
    })
    .from(agents)
    .leftJoin(userProfiles, eq(userProfiles.userId, agents.ownerUserId))
    .where(and(inArray(agents.repoId, repoIds), eq(agents.prNumber, prNumber)))
    .all()
    .map((r) => ({ ...r, ownerName: r.ownerName ?? "", prNumber: r.prNumber ?? prNumber }));
}
