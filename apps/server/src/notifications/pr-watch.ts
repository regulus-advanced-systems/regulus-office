/**
 * PR-merged detection for robots' pull requests (#42). Until GitHub webhooks
 * and board polling (#35) feed `NotificationCenter.pullRequestMerged`
 * directly, this polls the PRs of robots still in the office (one GET per
 * open robot PR per interval) with the repo's own office-side credential
 * (repo-access.ts). A merged or closed PR is marked in `notification_marks`
 * and never polled or notified again, also across restarts.
 *
 * The token stays inside `withRepoCredential`; nothing from GitHub's
 * responses is logged except the status code.
 */
import { and, eq, gt, isNotNull } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { agents, userProfiles } from "../db/schema/index.ts";
import type { RepoAccess } from "../github/repo-access.ts";
import type { Logger } from "../logging.ts";
import type { NotificationCenter } from "./center.ts";
import type { NotificationDirectory } from "./directory.ts";
import type { RobotSnapshot } from "./events.ts";
import type { FetchFn } from "./senders.ts";

export interface PrWatchOptions {
  db: Db;
  repos: Pick<RepoAccess, "withRepoCredential">;
  center: Pick<NotificationCenter, "pullRequestMerged">;
  directory: Pick<NotificationDirectory, "hasMark" | "mark">;
  apiBase: string;
  logger: Logger;
  fetch?: FetchFn;
  intervalMs?: number;
}

export const mergedMark = (repoId: string, n: number) => `pr_merged:${repoId}#${n}`;
export const closedMark = (repoId: string, n: number) => `pr_closed:${repoId}#${n}`;

type PullState = "merged" | "closed" | "open" | "unknown";

export class PrWatcher {
  readonly #o: PrWatchOptions;
  #timer: ReturnType<typeof setInterval> | undefined;
  #running = false;

  constructor(opts: PrWatchOptions) {
    this.#o = opts;
  }

  start(): void {
    if (this.#timer) return;
    this.#timer = setInterval(() => void this.tick(), this.#o.intervalMs ?? 60_000);
    (this.#timer as { unref?: () => void }).unref?.();
  }

  stop(): void {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = undefined;
  }

  /** One pass over the robots with an open PR. */
  async tick(): Promise<void> {
    if (this.#running) return;
    this.#running = true;
    try {
      for (const robot of this.#robots()) {
        const { repoId, prNumber } = robot;
        if (this.#o.directory.hasMark(mergedMark(repoId, prNumber))) continue;
        if (this.#o.directory.hasMark(closedMark(repoId, prNumber))) continue;
        const state = await this.#state(repoId, prNumber);
        if (state === "merged" && this.#o.directory.mark(mergedMark(repoId, prNumber))) {
          this.#o.center.pullRequestMerged(robot);
        } else if (state === "closed") {
          this.#o.directory.mark(closedMark(repoId, prNumber));
        }
      }
    } finally {
      this.#running = false;
    }
  }

  #robots(): RobotSnapshot[] {
    return this.#o.db
      .select({
        agentId: agents.id,
        floorId: agents.floorId,
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
      .where(and(isNotNull(agents.prNumber), gt(agents.prNumber, 0)))
      .all()
      .map((r) => ({ ...r, ownerName: r.ownerName ?? "", prNumber: r.prNumber ?? 0 }));
  }

  async #state(repoId: string, prNumber: number): Promise<PullState> {
    const doFetch = this.#o.fetch ?? ((input, init) => fetch(input, init));
    try {
      return await this.#o.repos.withRepoCredential(repoId, async ({ repo, token }) => {
        const url = `${this.#o.apiBase.replace(/\/+$/, "")}/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}/pulls/${prNumber}`;
        const headers: Record<string, string> = {
          accept: "application/vnd.github+json",
          "x-github-api-version": "2022-11-28",
        };
        if (token) headers.authorization = `Bearer ${token}`;
        const res = await doFetch(url, {
          method: "GET",
          headers,
          redirect: "manual",
          signal: AbortSignal.timeout(15_000),
        });
        if (!res.ok) {
          await res.body?.cancel().catch(() => {});
          this.#o.logger.debug({ repoId, prNumber, status: res.status }, "PR state unavailable");
          return "unknown";
        }
        const body = (await res.json().catch(() => null)) as {
          state?: unknown;
          merged?: unknown;
          merged_at?: unknown;
        } | null;
        if (body?.merged === true || (typeof body?.merged_at === "string" && body.merged_at)) {
          return "merged";
        }
        return body?.state === "closed" ? "closed" : body?.state === "open" ? "open" : "unknown";
      });
    } catch (err) {
      this.#o.logger.debug({ repoId, prNumber, err: (err as Error).name }, "PR state check failed");
      return "unknown";
    }
  }
}
