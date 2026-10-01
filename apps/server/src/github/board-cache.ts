/**
 * The board cache (SPEC §5 `github_issues`, `github_pulls`; #35): rows per
 * operation repo, written from verified webhooks and from polling. One GitHub repo
 * can back several operations, so every write goes to each operation repo row that
 * follows it. A write never moves a row back in time: an object older than
 * the cached one (a replayed or out-of-order delivery) is ignored.
 */
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { githubIssues, githubPulls, operationRepos, operations } from "../db/schema/index.ts";
import {
  aggregateChecks,
  aggregateReviews,
  type CardFields,
  type PullFields,
  type ReviewerState,
  type SuiteState,
} from "./board-normalize.ts";

export interface FollowedRepo {
  owner: string;
  name: string;
  repoIds: string[];
  operationIds: string[];
}

/** What a write changed, for the poller's synthetic events. */
export type CardChange = "new" | "closed" | "reopened" | "synchronize" | "updated" | "none";

type PullRow = typeof githubPulls.$inferSelect;

const parse = <T>(text: string, fallback: T): T => {
  try {
    const v = JSON.parse(text) as unknown;
    return v !== null && typeof v === "object" ? (v as T) : fallback;
  } catch {
    return fallback;
  }
};

function changeOf(
  before: { state: string; ghUpdatedAt: Date } | undefined,
  after: CardFields,
  shaMoved = false,
): CardChange {
  if (!before) return "new";
  if (before.state !== after.state) return after.state === "closed" ? "closed" : "reopened";
  if (shaMoved) return "synchronize";
  return after.ghUpdatedAt > before.ghUpdatedAt.getTime() ? "updated" : "none";
}

export class BoardCache {
  readonly #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  /** Every GitHub repo followed by a live operation, with its operation repo rows. */
  followedRepos(): FollowedRepo[] {
    const rows = this.#db
      .select({
        id: operationRepos.id,
        operationId: operationRepos.operationId,
        owner: operationRepos.owner,
        name: operationRepos.name,
      })
      .from(operationRepos)
      .innerJoin(operations, eq(operations.id, operationRepos.operationId))
      .where(isNull(operations.archivedAt))
      .all();
    const byKey = new Map<string, FollowedRepo>();
    for (const r of rows) {
      const key = `${r.owner}/${r.name}`.toLowerCase();
      const entry = byKey.get(key) ?? {
        owner: r.owner,
        name: r.name,
        repoIds: [],
        operationIds: [],
      };
      entry.repoIds.push(r.id);
      if (!entry.operationIds.includes(r.operationId)) entry.operationIds.push(r.operationId);
      byKey.set(key, entry);
    }
    return [...byKey.values()];
  }

  /** The operation repo rows following `owner/name` (case-insensitive), or null. */
  follow(owner: string, name: string): FollowedRepo | null {
    const key = `${owner}/${name}`.toLowerCase();
    return this.followedRepos().find((r) => `${r.owner}/${r.name}`.toLowerCase() === key) ?? null;
  }

  upsertIssue(repoIds: readonly string[], fields: CardFields): CardChange {
    let change: CardChange = "none";
    for (const repoId of repoIds) {
      const before = this.#db
        .select({ state: githubIssues.state, ghUpdatedAt: githubIssues.ghUpdatedAt })
        .from(githubIssues)
        .where(and(eq(githubIssues.repoId, repoId), eq(githubIssues.number, fields.number)))
        .get();
      if (before && before.ghUpdatedAt.getTime() > fields.ghUpdatedAt) continue;
      const values = {
        title: fields.title,
        state: fields.state,
        labelsJson: JSON.stringify(fields.labels),
        assigneesJson: JSON.stringify(fields.assignees),
        ghUpdatedAt: new Date(fields.ghUpdatedAt),
        bodyMd: fields.bodyMd,
        raw: JSON.stringify(fields.raw),
      };
      this.#db
        .insert(githubIssues)
        .values({ repoId, number: fields.number, ...values })
        .onConflictDoUpdate({ target: [githubIssues.repoId, githubIssues.number], set: values })
        .run();
      if (change === "none") change = changeOf(before, fields);
    }
    return change;
  }

  deleteIssue(repoIds: readonly string[], number: number): void {
    if (repoIds.length === 0) return;
    this.#db
      .delete(githubIssues)
      .where(and(inArray(githubIssues.repoId, [...repoIds]), eq(githubIssues.number, number)))
      .run();
  }

  #pull(repoId: string, number: number): PullRow | undefined {
    return this.#db
      .select()
      .from(githubPulls)
      .where(and(eq(githubPulls.repoId, repoId), eq(githubPulls.number, number)))
      .get();
  }

  upsertPull(repoIds: readonly string[], fields: PullFields): CardChange {
    let change: CardChange = "none";
    for (const repoId of repoIds) {
      const before = this.#pull(repoId, fields.number);
      if (before && before.ghUpdatedAt.getTime() > fields.ghUpdatedAt) continue;
      const shaMoved = Boolean(
        before?.headSha && fields.headSha && before.headSha !== fields.headSha,
      );
      // New commits: the old head's checks no longer describe the PR.
      const checks = shaMoved
        ? {}
        : parse<Record<string, SuiteState>>(before?.checksJson ?? "{}", {});
      const reviews = parse<Record<string, ReviewerState>>(before?.reviewsJson ?? "{}", {});
      const values = {
        title: fields.title,
        state: fields.state,
        labelsJson: JSON.stringify(fields.labels),
        assigneesJson: JSON.stringify(fields.assignees),
        ghUpdatedAt: new Date(fields.ghUpdatedAt),
        bodyMd: fields.bodyMd,
        raw: JSON.stringify(fields.raw),
        headRef: fields.headRef,
        headSha: fields.headSha,
        baseRef: fields.baseRef,
        isDraft: fields.isDraft,
        checksJson: JSON.stringify(checks),
        checksState: aggregateChecks(checks),
        reviewState: aggregateReviews(reviews, requestedCount(fields.raw)),
      };
      this.#db
        .insert(githubPulls)
        .values({ repoId, number: fields.number, ...values })
        .onConflictDoUpdate({ target: [githubPulls.repoId, githubPulls.number], set: values })
        .run();
      if (change === "none") change = changeOf(before, fields, shaMoved);
    }
    return change;
  }

  /** Record one reviewer's latest review (`reviews` replaces all when `replace`). */
  applyReviews(
    repoIds: readonly string[],
    number: number,
    reviews: Record<string, ReviewerState>,
    replace = false,
  ): boolean {
    let touched = false;
    for (const repoId of repoIds) {
      const row = this.#pull(repoId, number);
      if (!row) continue;
      const merged = replace
        ? reviews
        : { ...parse<Record<string, ReviewerState>>(row.reviewsJson, {}), ...reviews };
      const reviewState = aggregateReviews(merged, requestedCount(parse(row.raw, {})));
      this.#db
        .update(githubPulls)
        .set({ reviewsJson: JSON.stringify(merged), reviewState })
        .where(eq(githubPulls.id, row.id))
        .run();
      touched = true;
    }
    return touched;
  }

  /**
   * Record check suite states for the PRs whose head is `headSha` (suites of
   * fork PRs list no PR numbers, so the head sha is the join). `replace` sets
   * the full map (polling).
   */
  applyChecks(
    repoIds: readonly string[],
    headSha: string,
    suites: Record<string, SuiteState | null>,
    replace = false,
  ): boolean {
    if (repoIds.length === 0) return false;
    const rows = this.#db
      .select()
      .from(githubPulls)
      .where(and(inArray(githubPulls.repoId, [...repoIds]), eq(githubPulls.headSha, headSha)))
      .all();
    let touched = false;
    for (const row of rows) {
      const current = replace ? {} : parse<Record<string, SuiteState>>(row.checksJson, {});
      for (const [id, state] of Object.entries(suites)) {
        if (state) current[id] = state;
        else delete current[id];
      }
      this.#db
        .update(githubPulls)
        .set({ checksJson: JSON.stringify(current), checksState: aggregateChecks(current) })
        .where(eq(githubPulls.id, row.id))
        .run();
      touched = true;
    }
    return touched;
  }

  /** Open PRs of a repo row, most recently updated first (for polling checks and reviews). */
  openPulls(
    repoId: string,
    limit: number,
  ): { number: number; headSha: string | null; ghUpdatedAt: number }[] {
    return this.#db
      .select({
        number: githubPulls.number,
        headSha: githubPulls.headSha,
        ghUpdatedAt: githubPulls.ghUpdatedAt,
      })
      .from(githubPulls)
      .where(and(eq(githubPulls.repoId, repoId), eq(githubPulls.state, "open")))
      .orderBy(sql`${githubPulls.ghUpdatedAt} desc`)
      .limit(limit)
      .all()
      .map((r) => ({ ...r, ghUpdatedAt: r.ghUpdatedAt.getTime() }));
  }
}

function requestedCount(raw: Record<string, unknown>): number {
  const people = Array.isArray(raw.requestedReviewers) ? raw.requestedReviewers.length : 0;
  const teams = typeof raw.requestedTeams === "number" ? raw.requestedTeams : 0;
  return people + teams;
}
