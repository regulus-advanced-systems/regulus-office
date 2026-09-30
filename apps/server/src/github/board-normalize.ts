/**
 * Pure mapping from GitHub REST / webhook objects to the board cache (#35):
 * issues and pull requests (same object shape in webhooks and REST), check
 * suites → an aggregate CI state, reviews → an aggregate review state.
 *
 * https://docs.github.com/en/rest/issues/issues#list-repository-issues
 * https://docs.github.com/en/rest/pulls/pulls#list-pull-requests
 * https://docs.github.com/en/rest/checks/suites#list-check-suites-for-a-git-reference
 * https://docs.github.com/en/rest/pulls/reviews#list-reviews-for-a-pull-request
 */
import type { ChecksState, ReviewState } from "@regulus/protocol";
import type { RawObject } from "./events.ts";

const MAX_LIST = 20;

const obj = (v: unknown): RawObject | null =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as RawObject) : null;
const str = (v: unknown, max: number): string | null =>
  typeof v === "string" ? v.slice(0, max) : null;
const time = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v < 1e12 ? v * 1000 : v;
  if (typeof v !== "string") return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
};
const logins = (v: unknown): string[] =>
  (Array.isArray(v) ? v : [])
    .map((a) => str(obj(a)?.login, 64))
    .filter((l): l is string => l !== null)
    .slice(0, MAX_LIST);

export interface CardFields {
  number: number;
  title: string;
  state: string;
  labels: string[];
  assignees: string[];
  ghUpdatedAt: number;
  bodyMd: string | null;
  /** The trimmed object kept in `raw` (author, URL, merge and review details). */
  raw: RawObject;
}

export interface PullFields extends CardFields {
  headRef: string | null;
  headSha: string | null;
  baseRef: string | null;
  isDraft: boolean;
}

const MAX_BODY = 16_000;

function card(raw: unknown): CardFields | null {
  const o = obj(raw);
  const updated = time(o?.updated_at);
  if (!o || typeof o.number !== "number" || typeof o.title !== "string" || updated === null) {
    return null;
  }
  if (typeof o.state !== "string") return null;
  const labels = (Array.isArray(o.labels) ? o.labels : [])
    .map((l) => (typeof l === "string" ? l.slice(0, 64) : str(obj(l)?.name, 64)))
    .filter((l): l is string => l !== null)
    .slice(0, MAX_LIST);
  return {
    number: o.number,
    title: o.title.slice(0, 300),
    state: o.state.slice(0, 16),
    labels,
    assignees: logins(o.assignees),
    ghUpdatedAt: updated,
    bodyMd: str(o.body, MAX_BODY),
    raw: {
      author: str(obj(o.user)?.login, 64) ?? "",
      htmlUrl: str(o.html_url, 512) ?? "",
      closedAt: time(o.closed_at),
      stateReason: str(o.state_reason, 32),
      performedViaAppId: obj(o.performed_via_github_app)?.id ?? null,
    },
  };
}

/** An issue from a webhook or the issues list; null for a pull request or a malformed object. */
export function normalizeIssue(raw: unknown): CardFields | null {
  if (obj(raw)?.pull_request !== undefined) return null;
  return card(raw);
}

export function normalizePull(raw: unknown): PullFields | null {
  const base = card(raw);
  const o = obj(raw);
  if (!base || !o) return null;
  const head = obj(o.head);
  return {
    ...base,
    raw: {
      ...base.raw,
      merged: o.merged === true || typeof o.merged_at === "string",
      requestedReviewers: logins(o.requested_reviewers),
      requestedTeams: Array.isArray(o.requested_teams) ? o.requested_teams.length : 0,
    },
    headRef: str(head?.ref, 200),
    headSha: str(head?.sha, 64),
    baseRef: str(obj(o.base)?.ref, 200),
    isDraft: o.draft === true,
  };
}

/** A check suite's contribution: null when it should be ignored. */
export type SuiteState = "pending" | "success" | "failure";

const FAILED = new Set(["failure", "timed_out", "cancelled", "action_required", "startup_failure"]);
const PASSED = new Set(["success", "neutral", "skipped"]);

/**
 * GitHub creates a suite for every installed app that could check a commit;
 * a suite that is not completed and has no runs never will be, so it is
 * ignored rather than holding the PR at `pending` forever.
 */
export function suiteState(suite: unknown): SuiteState | null {
  const s = obj(suite);
  if (!s) return null;
  if (s.status !== "completed") {
    if (s.latest_check_runs_count === 0) return null;
    return "pending";
  }
  if (typeof s.conclusion !== "string") return null;
  if (FAILED.has(s.conclusion)) return "failure";
  if (PASSED.has(s.conclusion)) return "success";
  return null; // stale and anything new
}

export function aggregateChecks(suites: Record<string, SuiteState>): ChecksState {
  const states = Object.values(suites);
  if (states.length === 0) return "none";
  if (states.includes("failure")) return "failure";
  if (states.includes("pending")) return "pending";
  return "success";
}

/** Reviewer login → `approved` | `changes_requested` | `dismissed` (comments do not count). */
export type ReviewerState = "approved" | "changes_requested" | "dismissed";

export function reviewerState(state: unknown): ReviewerState | null {
  const s = typeof state === "string" ? state.toLowerCase() : "";
  if (s === "approved" || s === "changes_requested" || s === "dismissed") return s;
  return null;
}

export function aggregateReviews(
  reviews: Record<string, ReviewerState>,
  requested: number,
): ReviewState {
  const states = Object.values(reviews);
  if (states.includes("changes_requested")) return "changes_requested";
  if (states.includes("approved")) return "approved";
  return requested > 0 ? "review_required" : "none";
}

/** Latest state per reviewer from a list of reviews in submission order. */
export function reviewsFromList(list: unknown): Record<string, ReviewerState> {
  const out: Record<string, ReviewerState> = {};
  for (const review of Array.isArray(list) ? list : []) {
    const r = obj(review);
    const login = str(obj(r?.user)?.login, 64);
    const state = reviewerState(r?.state);
    if (login && state) out[login] = state;
  }
  return out;
}

/** The time the event's object last changed, for replay detection; null when unknown. */
export function payloadTime(payload: RawObject): number | null {
  const candidates = [
    obj(payload.review)?.submitted_at,
    obj(payload.comment)?.updated_at,
    obj(payload.check_run)?.completed_at ?? obj(payload.check_run)?.started_at,
    obj(payload.check_suite)?.updated_at,
    obj(payload.pull_request)?.updated_at,
    obj(payload.issue)?.updated_at,
    typeof payload.after === "string" ? obj(payload.repository)?.pushed_at : undefined,
  ];
  for (const c of candidates) {
    const t = time(c);
    if (t !== null) return t;
  }
  return null;
}

export { obj as asObject, time as parseTime };
