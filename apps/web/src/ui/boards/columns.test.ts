import { describe, expect, test } from "bun:test";
import type { IssueCard, PullCard, RepoSummary } from "@regulus/protocol";
import { buildBoard, checksBadge, issueColumn, pullColumn, reviewBadge } from "./columns.ts";

const issue = (number: number, over: Partial<IssueCard> = {}): IssueCard => ({
  repoId: "r1",
  number,
  title: `Issue ${number}`,
  state: "open",
  labels: [],
  assignees: [],
  author: "olga",
  url: `https://github.com/octo/hello/issues/${number}`,
  updatedAt: 1_000 + number,
  ...over,
});

const pull = (number: number, over: Partial<PullCard> = {}): PullCard => ({
  ...issue(number),
  title: `PR ${number}`,
  draft: false,
  merged: false,
  headBranch: `fix-${number}`,
  checksState: "none",
  reviewState: "none",
  ...over,
});

const repo = (repoId: string, name: string): RepoSummary => ({
  repoId,
  owner: "octo",
  name,
  defaultBranch: "main",
  isPrimary: repoId === "r1",
});

describe("issue columns", () => {
  test("open, in progress (assignee, label or a robot on it) and closed", () => {
    expect(issueColumn(issue(1))).toBe("open");
    expect(issueColumn(issue(1, { assignees: ["ada"] }))).toBe("in_progress");
    expect(issueColumn(issue(1, { labels: ["In Progress"] }))).toBe("in_progress");
    expect(issueColumn(issue(1, { labels: ["wip"] }))).toBe("in_progress");
    expect(issueColumn(issue(1, { labels: ["bug", "progress report"] }))).toBe("open");
    expect(issueColumn(issue(7), new Set(["r1#7"]))).toBe("in_progress");
    expect(issueColumn(issue(7), new Set(["r2#7"]))).toBe("open");
    expect(issueColumn(issue(1, { state: "closed", assignees: ["ada"] }))).toBe("closed");
  });
});

describe("PR columns", () => {
  test("draft, in review, approved, merged and closed", () => {
    expect(pullColumn(pull(1, { draft: true }))).toBe("draft");
    expect(pullColumn(pull(1))).toBe("in_review");
    expect(pullColumn(pull(1, { reviewState: "changes_requested" }))).toBe("in_review");
    expect(pullColumn(pull(1, { reviewState: "approved" }))).toBe("approved");
    expect(pullColumn(pull(1, { state: "closed", merged: true }))).toBe("merged");
    expect(pullColumn(pull(1, { state: "closed" }))).toBe("closed");
    // A merged draft is merged; a closed draft is closed.
    expect(pullColumn(pull(1, { state: "closed", merged: true, draft: true }))).toBe("merged");
    expect(pullColumn(pull(1, { state: "closed", draft: true }))).toBe("closed");
  });
});

describe("CI and review status", () => {
  test("every checks state maps to a label and a tone", () => {
    expect(checksBadge("success")).toMatchObject({ label: "Checks passed", tone: "green" });
    expect(checksBadge("failure")).toMatchObject({ label: "Checks failing", tone: "red" });
    expect(checksBadge("pending")).toMatchObject({ label: "Checks running", tone: "amber" });
    expect(checksBadge("none")).toMatchObject({ label: "No checks", tone: "grey" });
  });

  test("review badges; none shows nothing", () => {
    expect(reviewBadge("approved")?.tone).toBe("green");
    expect(reviewBadge("changes_requested")?.label).toBe("Changes requested");
    expect(reviewBadge("review_required")?.tone).toBe("amber");
    expect(reviewBadge("none")).toBeNull();
  });
});

describe("buildBoard", () => {
  const issues = {
    "r1#1": issue(1),
    "r1#2": issue(2, { assignees: ["ada"] }),
    "r2#3": issue(3, { repoId: "r2", updatedAt: 5_000 }),
    "r1#4": issue(4, { state: "closed" }),
  };
  const pulls = {
    "r1#10": pull(10, { checksState: "failure" }),
    "r1#11": pull(11, { state: "closed", merged: true, checksState: "success" }),
    "r1#12": pull(12, { draft: true, checksState: "pending" }),
  };

  test("issue board: three columns, newest first, repo chips only on multi-repo floors", () => {
    const one = buildBoard("issue", { issues, pulls, repos: [repo("r1", "hello")] });
    expect(one.map((c) => c.id)).toEqual(["open", "in_progress", "closed"]);
    expect(one[0]?.cards.map((c) => c.number)).toEqual([3, 1]);
    expect(one[0]?.cards.every((c) => c.repoChip === "")).toBe(true);

    const two = buildBoard("issue", {
      issues,
      pulls,
      repos: [repo("r1", "hello"), repo("r2", "other")],
      robots: [{ repoId: "r1", issueNumber: 1 }],
    });
    expect(two[0]?.cards.map((c) => [c.number, c.repoChip])).toEqual([[3, "octo/other"]]);
    expect(two[1]?.cards.map((c) => c.number).sort()).toEqual([1, 2]);
    expect(two[2]?.cards.map((c) => c.number)).toEqual([4]);
  });

  test("PR board: five columns; merged and closed cards carry no CI badge", () => {
    const board = buildBoard("pr", { issues, pulls, repos: [repo("r1", "hello")] });
    expect(board.map((c) => c.id)).toEqual(["draft", "in_review", "approved", "merged", "closed"]);
    const byNumber = new Map(board.flatMap((c) => c.cards).map((c) => [c.number, c]));
    expect(byNumber.get(10)?.column).toBe("in_review");
    expect(byNumber.get(10)?.checks?.tone).toBe("red");
    expect(byNumber.get(12)?.checks?.tone).toBe("amber");
    expect(byNumber.get(11)?.column).toBe("merged");
    expect(byNumber.get(11)?.checks).toBeNull();
  });
});
