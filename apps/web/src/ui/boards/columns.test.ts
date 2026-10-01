import { describe, expect, test } from "bun:test";
import {
  AGENT_STATUSES,
  type AgentStatus,
  type IssueCard,
  type PullCard,
  type RepoSummary,
} from "@regulus/protocol";
import {
  buildBoard,
  checksBadge,
  issueColumn,
  pullColumn,
  queuedIssues,
  reviewBadge,
  workedIssues,
} from "./columns.ts";

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

const hench = (status: AgentStatus, issueNumber = 7, repoId = "r1") => ({
  repoId,
  issueNumber,
  status,
});

const columnWith = (card: IssueCard, ...henchmen: ReturnType<typeof hench>[]) =>
  issueColumn(card, workedIssues(henchmen));

describe("issue columns (#237: In progress only while a henchman works on it)", () => {
  test("open and closed by GitHub state", () => {
    expect(issueColumn(issue(1))).toBe("open");
    expect(issueColumn(issue(1, { state: "closed" }))).toBe("closed");
    // A closed issue stays closed even with a henchman still working on it.
    expect(columnWith(issue(7, { state: "closed" }), hench("working"))).toBe("closed");
  });

  test("assignees and in-progress labels no longer move a card", () => {
    expect(issueColumn(issue(1, { assignees: ["ada"] }))).toBe("open");
    expect(issueColumn(issue(1, { labels: ["In Progress"] }))).toBe("open");
    for (const l of ["wip", "doing", "started", "working"]) {
      expect(issueColumn(issue(1, { labels: [l], assignees: ["ada"] }))).toBe("open");
    }
  });

  test("each henchman status: only the active ones count", () => {
    const active = new Set(["starting", "working", "waiting_permission", "waiting_input"]);
    for (const status of AGENT_STATUSES) {
      expect(columnWith(issue(7), hench(status))).toBe(active.has(status) ? "in_progress" : "open");
    }
  });

  test("two henchmen on one issue: one done, one working", () => {
    expect(columnWith(issue(7), hench("done"), hench("working"))).toBe("in_progress");
    expect(columnWith(issue(7), hench("working"), hench("exited"))).toBe("in_progress");
    expect(columnWith(issue(7), hench("done"), hench("exited"))).toBe("open");
  });

  test("scoped to the henchman's repo and issue number; unbound henchmen never count", () => {
    expect(columnWith(issue(7), hench("working", 7, "r2"))).toBe("open");
    expect(columnWith(issue(7, { repoId: "r2" }), hench("working", 7, "r2"))).toBe("in_progress");
    expect(columnWith(issue(7), hench("working", 8))).toBe("open");
    expect([...workedIssues([hench("working", 0)])]).toEqual([]);
  });

  test("only queued issue tasks are queued", () => {
    const task = (state: "queued" | "running" | "done", kind: "issue" | "pr" = "issue") => ({
      kind,
      repoId: "r1",
      refNumber: 7,
      state,
    });
    expect([...queuedIssues([task("queued")])]).toEqual(["r1#7"]);
    expect([...queuedIssues([task("running"), task("done"), task("queued", "pr")])]).toEqual([]);
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
    "r1#2": issue(2, { assignees: ["ada"], labels: ["wip"] }),
    "r2#3": issue(3, { repoId: "r2", updatedAt: 5_000 }),
    "r1#4": issue(4, { state: "closed" }),
  };
  const pulls = {
    "r1#10": pull(10, { checksState: "failure" }),
    "r1#11": pull(11, { state: "closed", merged: true, checksState: "success" }),
    "r1#12": pull(12, { draft: true, checksState: "pending" }),
  };

  test("issue board: three columns, newest first, repo chips only on multi-repo operations", () => {
    const one = buildBoard("issue", { issues, pulls, repos: [repo("r1", "hello")] });
    expect(one.map((c) => c.id)).toEqual(["open", "in_progress", "closed"]);
    expect(one[0]?.cards.map((c) => c.number)).toEqual([3, 2, 1]);
    expect(one[0]?.cards.every((c) => c.repoChip === "")).toBe(true);

    const two = buildBoard("issue", {
      issues,
      pulls,
      repos: [repo("r1", "hello"), repo("r2", "other")],
      henchmen: [hench("working", 1), hench("done", 2)],
    });
    // #2 is assigned, labelled wip and its henchman is done: Open, with assignee and label shown.
    expect(two[0]?.cards.map((c) => [c.number, c.repoChip])).toEqual([
      [3, "octo/other"],
      [2, "octo/hello"],
    ]);
    expect(two[0]?.cards.find((c) => c.number === 2)).toMatchObject({
      assignees: ["ada"],
      labels: ["wip"],
    });
    expect(two[1]?.cards.map((c) => c.number)).toEqual([1]);
    expect(two[2]?.cards.map((c) => c.number)).toEqual([4]);
  });

  test("issue board: a queued task shows a chip but leaves the card in Open", () => {
    const board = buildBoard("issue", {
      issues,
      pulls,
      repos: [repo("r1", "hello")],
      henchmen: [hench("working", 1)],
      queue: [
        { kind: "issue", repoId: "r2", refNumber: 3, state: "queued" },
        { kind: "issue", repoId: "r1", refNumber: 1, state: "queued" },
      ],
    });
    const byNumber = new Map(board.flatMap((c) => c.cards).map((c) => [c.number, c]));
    expect(byNumber.get(3)).toMatchObject({ column: "open", queued: true });
    expect(byNumber.get(2)).toMatchObject({ column: "open", queued: false });
    // Already being worked on: In progress, no queued chip.
    expect(byNumber.get(1)).toMatchObject({ column: "in_progress", queued: false });
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
