/**
 * Board summaries for the FloorRoom (SPEC §6 channel 2 "issue/PR board
 * summaries"; #35, UI in #36): the cached issues and PRs of every repo on a
 * floor as protocol `IssueCard` / `PullCard`s. Open cards, plus cards closed
 * in the last two days (so a merge still shows), newest first and capped so
 * the room state stays small.
 */
import {
  CHECKS_STATES,
  type ChecksState,
  type IssueCard,
  type PullCard,
  REVIEW_STATES,
  type ReviewState,
} from "@regulus/protocol";
import { and, desc, eq, gt, inArray, or } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { floorRepos, githubIssues, githubPulls } from "../db/schema/index.ts";

export const BOARD_CARD_LIMIT = 200;
export const RECENTLY_CLOSED_MS = 2 * 24 * 60 * 60_000;

export interface FloorBoard {
  issues: IssueCard[];
  pulls: PullCard[];
}

/** Where summaries go: `FloorRooms.publishBoard`. */
export interface BoardSink {
  publishBoard(floorId: string, board: FloorBoard): void;
}

const list = (text: string): string[] => {
  try {
    const v = JSON.parse(text) as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
};
const rawOf = (text: string): Record<string, unknown> => {
  try {
    const v = JSON.parse(text) as unknown;
    return v !== null && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};
const s = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");

export function buildFloorBoard(db: Db, floorId: string, now = Date.now()): FloorBoard {
  const repoIds = db
    .select({ id: floorRepos.id })
    .from(floorRepos)
    .where(eq(floorRepos.floorId, floorId))
    .all()
    .map((r) => r.id);
  if (repoIds.length === 0) return { issues: [], pulls: [] };
  const since = new Date(now - RECENTLY_CLOSED_MS);

  const issueRows = db
    .select()
    .from(githubIssues)
    .where(
      and(
        inArray(githubIssues.repoId, repoIds),
        or(eq(githubIssues.state, "open"), gt(githubIssues.ghUpdatedAt, since)),
      ),
    )
    .orderBy(desc(githubIssues.ghUpdatedAt))
    .limit(BOARD_CARD_LIMIT)
    .all();
  const pullRows = db
    .select()
    .from(githubPulls)
    .where(
      and(
        inArray(githubPulls.repoId, repoIds),
        or(eq(githubPulls.state, "open"), gt(githubPulls.ghUpdatedAt, since)),
      ),
    )
    .orderBy(desc(githubPulls.ghUpdatedAt))
    .limit(BOARD_CARD_LIMIT)
    .all();

  const base = (row: (typeof issueRows)[number] | (typeof pullRows)[number]) => {
    const raw = rawOf(row.raw);
    return {
      repoId: row.repoId,
      number: row.number,
      title: row.title.slice(0, 300),
      state: row.state.slice(0, 16),
      labels: list(row.labelsJson).map((l) => l.slice(0, 64)),
      assignees: list(row.assigneesJson).map((a) => a.slice(0, 64)),
      author: s(raw.author, 64),
      url: s(raw.htmlUrl, 512),
      updatedAt: row.ghUpdatedAt.getTime(),
    };
  };
  return {
    issues: issueRows.map(base),
    pulls: pullRows.map((row) => ({
      ...base(row),
      draft: row.isDraft,
      merged: rawOf(row.raw).merged === true,
      headBranch: (row.headRef ?? "").slice(0, 200),
      checksState: (CHECKS_STATES as readonly string[]).includes(row.checksState)
        ? (row.checksState as ChecksState)
        : "none",
      reviewState: (REVIEW_STATES as readonly string[]).includes(row.reviewState)
        ? (row.reviewState as ReviewState)
        : "none",
    })),
  };
}
