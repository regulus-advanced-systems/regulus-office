/**
 * Which PR merges ring the gong (#43), and where. A merge is a `pull_request`
 * `closed` event with the PR merged (`merged`, or `merged_at` from polling),
 * from a verified webhook or a poll (#35), or a merge made from the office's
 * own PR board (#36), which reports it at once instead of waiting for them.
 *
 * Each merge rings once per floor repo row: a mark in `notification_marks`
 * (`gong:pr_merged:<repoId>#<n>`, apart from #42's notification marks) is
 * claimed first, so a webhook, a poll and the board reporting the same
 * merge, or a replay after a restart, ring only the first time.
 */
import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { floorRepos, githubPulls, notificationMarks } from "../db/schema/index.ts";
import type { GitHubEvent } from "../github/events.ts";

export const gongMark = (repoId: string, n: number) => `gong:pr_merged:${repoId}#${n}`;

export interface MergedPull {
  repoIds: readonly string[];
  number: number;
  /** From the payload when there is one; else read from the board cache. */
  title?: string;
}

/** The merged PR an event reports, or null (not a merge, a stale replay, no floor repo). */
export function mergedPullOf(event: GitHubEvent<"pull_request">): MergedPull | null {
  if (event.action !== "closed" || event.stale || event.repoIds.length === 0) return null;
  const pr = event.payload.pull_request;
  const number = pr?.number ?? event.payload.number;
  const merged = pr?.merged === true || (typeof pr?.merged_at === "string" && pr.merged_at !== "");
  if (!merged || typeof number !== "number" || !(number > 0)) return null;
  return {
    repoIds: event.repoIds,
    number,
    ...(typeof pr?.title === "string" ? { title: pr.title } : {}),
  };
}

/** Claim a one-time mark; false when it was claimed before. */
export function claimMark(db: Db, key: string): boolean {
  return (
    db
      .insert(notificationMarks)
      .values({ key })
      .onConflictDoNothing()
      .returning({ key: notificationMarks.key })
      .all().length > 0
  );
}

export interface MergeRing {
  floorId: string;
  repoId: string;
  number: number;
  title: string;
  url: string;
}

/**
 * The floors a merge rings on, claiming each repo row's mark: one entry per
 * floor (the first of its repo rows that was not rung for this PR yet).
 */
export function claimMergeRings(db: Db, pull: MergedPull, webBase: string): MergeRing[] {
  if (pull.repoIds.length === 0) return [];
  const rows = db
    .select({
      repoId: floorRepos.id,
      floorId: floorRepos.floorId,
      owner: floorRepos.owner,
      name: floorRepos.name,
    })
    .from(floorRepos)
    .where(inArray(floorRepos.id, [...pull.repoIds]))
    .all();
  const rings = new Map<string, MergeRing>();
  for (const row of rows) {
    if (!claimMark(db, gongMark(row.repoId, pull.number))) continue;
    if (rings.has(row.floorId)) continue;
    rings.set(row.floorId, {
      floorId: row.floorId,
      repoId: row.repoId,
      number: pull.number,
      title: (pull.title ?? cachedTitle(db, row.repoId, pull.number)).slice(0, 300),
      url: `${webBase}/${encodeURIComponent(row.owner)}/${encodeURIComponent(row.name)}/pull/${pull.number}`,
    });
  }
  return [...rings.values()];
}

function cachedTitle(db: Db, repoId: string, number: number): string {
  const row = db
    .select({ title: githubPulls.title })
    .from(githubPulls)
    .where(and(eq(githubPulls.repoId, repoId), eq(githubPulls.number, number)))
    .get();
  return row?.title ?? "";
}
