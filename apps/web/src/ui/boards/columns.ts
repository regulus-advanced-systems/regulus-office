/**
 * Which column a board card goes in (SPEC §9.4; #36), and how its CI and
 * review state read. Pure; the 3D boards (scene/boards) and the 2D panel
 * both use it.
 *
 * Issue board: Open / In progress / Closed. An open issue is In progress
 * only while a henchman on this operation, bound to it (repo + number), is
 * in an active status (`AGENT_ACTIVE_STATUSES`: starting, working, waiting
 * for permission or input; #237). Assignees and labels never move a card;
 * the card shows them instead. A queued task for the issue does not count
 * until a henchman picks it up; the card shows a "Queued" chip meanwhile.
 *
 * PR board: Draft / In review / Approved / Merged / Closed. An open PR is
 * Draft while it is a draft, Approved once reviews approve it (and nobody
 * asks for changes), else In review.
 */
import {
  type CardKind,
  type ChecksState,
  type HenchmanState,
  type IssueCard,
  isActiveAgentStatus,
  type PullCard,
  type QueueTask,
  type RepoSummary,
  type ReviewState,
} from "@regulus/protocol";

export type IssueColumn = "open" | "in_progress" | "closed";
export type PullColumn = "draft" | "in_review" | "approved" | "merged" | "closed";
export type BoardColumnId = IssueColumn | PullColumn;

export interface ColumnSpec<C extends BoardColumnId> {
  id: C;
  title: string;
}

export const ISSUE_COLUMNS: readonly ColumnSpec<IssueColumn>[] = [
  { id: "open", title: "Open" },
  { id: "in_progress", title: "In progress" },
  { id: "closed", title: "Closed" },
];

export const PULL_COLUMNS: readonly ColumnSpec<PullColumn>[] = [
  { id: "draft", title: "Draft" },
  { id: "in_review", title: "In review" },
  { id: "approved", title: "Approved" },
  { id: "merged", title: "Merged" },
  { id: "closed", title: "Closed" },
];

type IssueRef = `${string}#${number}`;
const issueRef = (repoId: string, number: number): IssueRef => `${repoId}#${number}`;

/**
 * `${repoId}#${number}` of the issues a henchman on this operation is working
 * on right now: bound to the issue and in an active status. A henchman that
 * is done, idle, in error, exited or sent home no longer counts.
 */
export function workedIssues(
  henchmen: readonly Pick<HenchmanState, "repoId" | "issueNumber" | "status">[],
): Set<string> {
  return new Set(
    henchmen
      .filter((h) => h.issueNumber > 0 && isActiveAgentStatus(h.status))
      .map((h) => issueRef(h.repoId, h.issueNumber)),
  );
}

/** `${repoId}#${number}` of the issues with a task still waiting in the queue. */
export function queuedIssues(
  queue: readonly Pick<QueueTask, "kind" | "repoId" | "refNumber" | "state">[],
): Set<string> {
  return new Set(
    queue
      .filter((t) => t.kind === "issue" && t.refNumber > 0 && t.state === "queued")
      .map((t) => issueRef(t.repoId, t.refNumber)),
  );
}

export function issueColumn(
  card: Pick<IssueCard, "state" | "repoId" | "number">,
  worked: ReadonlySet<string> = new Set(),
): IssueColumn {
  if (card.state !== "open") return "closed";
  if (worked.has(issueRef(card.repoId, card.number))) return "in_progress";
  return "open";
}

export function pullColumn(
  card: Pick<PullCard, "state" | "merged" | "draft" | "reviewState">,
): PullColumn {
  if (card.merged) return "merged";
  if (card.state !== "open") return "closed";
  if (card.draft) return "draft";
  if (card.reviewState === "approved") return "approved";
  return "in_review";
}

export type Tone = "green" | "red" | "amber" | "grey" | "blue";

export interface StatusBadge {
  label: string;
  tone: Tone;
  /** One-character glyph for the 3D board texture. */
  glyph: string;
}

export function checksBadge(state: ChecksState): StatusBadge {
  switch (state) {
    case "success":
      return { label: "Checks passed", tone: "green", glyph: "✓" };
    case "failure":
      return { label: "Checks failing", tone: "red", glyph: "✕" };
    case "pending":
      return { label: "Checks running", tone: "amber", glyph: "…" };
    default:
      return { label: "No checks", tone: "grey", glyph: "·" };
  }
}

export function reviewBadge(state: ReviewState): StatusBadge | null {
  switch (state) {
    case "approved":
      return { label: "Approved", tone: "green", glyph: "✓" };
    case "changes_requested":
      return { label: "Changes requested", tone: "red", glyph: "!" };
    case "review_required":
      return { label: "Review required", tone: "amber", glyph: "?" };
    default:
      return null;
  }
}

export interface BoardCardView {
  key: string;
  kind: CardKind;
  repoId: string;
  number: number;
  title: string;
  column: BoardColumnId;
  /** `owner/name` chip; empty on a single-repo operation. */
  repoChip: string;
  assignees: string[];
  labels: string[];
  /** An open issue with a task waiting in the queue and no henchman on it yet. */
  queued: boolean;
  checks: StatusBadge | null;
  review: StatusBadge | null;
  updatedAt: number;
}

export interface BoardColumnView {
  id: BoardColumnId;
  title: string;
  cards: BoardCardView[];
}

function repoChips(repos: readonly RepoSummary[]): Map<string, string> {
  if (repos.length < 2) return new Map();
  return new Map(repos.map((r) => [r.repoId, `${r.owner}/${r.name}`]));
}

const newestFirst = (a: BoardCardView, b: BoardCardView) =>
  b.updatedAt - a.updatedAt || b.number - a.number;

/** The board as columns of cards, newest first in each column. */
export function buildBoard(
  kind: CardKind,
  input: {
    issues: Readonly<Record<string, IssueCard>>;
    pulls: Readonly<Record<string, PullCard>>;
    repos: readonly RepoSummary[];
    henchmen?: readonly Pick<HenchmanState, "repoId" | "issueNumber" | "status">[];
    queue?: readonly Pick<QueueTask, "kind" | "repoId" | "refNumber" | "state">[];
  },
): BoardColumnView[] {
  const chips = repoChips(input.repos);
  const specs: readonly ColumnSpec<BoardColumnId>[] = kind === "pr" ? PULL_COLUMNS : ISSUE_COLUMNS;
  const columns = new Map<BoardColumnId, BoardColumnView>(
    specs.map((s) => [s.id, { id: s.id, title: s.title, cards: [] }]),
  );
  if (kind === "issue") {
    const worked = workedIssues(input.henchmen ?? []);
    const queued = queuedIssues(input.queue ?? []);
    for (const [key, c] of Object.entries(input.issues)) {
      const column = issueColumn(c, worked);
      columns.get(column)?.cards.push({
        key,
        kind,
        repoId: c.repoId,
        number: c.number,
        title: c.title,
        column,
        repoChip: chips.get(c.repoId) ?? "",
        assignees: c.assignees,
        labels: c.labels,
        queued: column === "open" && queued.has(issueRef(c.repoId, c.number)),
        checks: null,
        review: null,
        updatedAt: c.updatedAt,
      });
    }
  } else {
    for (const [key, c] of Object.entries(input.pulls)) {
      const column = pullColumn(c);
      columns.get(column)?.cards.push({
        key,
        kind,
        repoId: c.repoId,
        number: c.number,
        title: c.title,
        column,
        repoChip: chips.get(c.repoId) ?? "",
        assignees: c.assignees,
        labels: c.labels,
        queued: false,
        checks: column === "merged" || column === "closed" ? null : checksBadge(c.checksState),
        review: reviewBadge(c.reviewState),
        updatedAt: c.updatedAt,
      });
    }
  }
  const out = [...columns.values()];
  for (const col of out) col.cards.sort(newestFirst);
  return out;
}

export const BOARD_TITLES: Readonly<Record<CardKind, string>> = {
  issue: "Issue board",
  pr: "PR board",
};
