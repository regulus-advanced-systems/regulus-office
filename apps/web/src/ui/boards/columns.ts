/**
 * Which column a board card goes in (SPEC §9.4; #36), and how its CI and
 * review state read. Pure; the 3D boards (scene/boards) and the 2D panel
 * both use it.
 *
 * Issue board: Open / In progress / Closed. An open issue is in progress
 * when someone is assigned, it carries an "in progress"-style label, or a
 * robot on this floor works on it.
 *
 * PR board: Draft / In review / Approved / Merged / Closed. An open PR is
 * Draft while it is a draft, Approved once reviews approve it (and nobody
 * asks for changes), else In review.
 */
import type {
  CardKind,
  ChecksState,
  IssueCard,
  PullCard,
  RepoSummary,
  ReviewState,
  RobotState,
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

const IN_PROGRESS_LABEL = /^(in[\s_-]?progress|wip|doing|started|working)$/i;

/** `${repoId}#${number}` of the issues robots on this floor are working on. */
export function workedIssues(robots: readonly Pick<RobotState, "repoId" | "issueNumber">[]) {
  return new Set(
    robots.filter((r) => r.issueNumber > 0).map((r) => `${r.repoId}#${r.issueNumber}`),
  );
}

export function issueColumn(
  card: Pick<IssueCard, "state" | "assignees" | "labels" | "repoId" | "number">,
  worked: ReadonlySet<string> = new Set(),
): IssueColumn {
  if (card.state !== "open") return "closed";
  if (card.assignees.length > 0) return "in_progress";
  if (card.labels.some((l) => IN_PROGRESS_LABEL.test(l.trim()))) return "in_progress";
  if (worked.has(`${card.repoId}#${card.number}`)) return "in_progress";
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
  /** `owner/name` chip; empty on a single-repo floor. */
  repoChip: string;
  assignees: string[];
  labels: string[];
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
    robots?: readonly Pick<RobotState, "repoId" | "issueNumber">[];
  },
): BoardColumnView[] {
  const chips = repoChips(input.repos);
  const specs: readonly ColumnSpec<BoardColumnId>[] = kind === "pr" ? PULL_COLUMNS : ISSUE_COLUMNS;
  const columns = new Map<BoardColumnId, BoardColumnView>(
    specs.map((s) => [s.id, { id: s.id, title: s.title, cards: [] }]),
  );
  if (kind === "issue") {
    const worked = workedIssues(input.robots ?? []);
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
