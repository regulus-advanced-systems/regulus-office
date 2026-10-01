/** Trigger matching and filters (#155). */
import { describe, expect, test } from "bun:test";
import { WorkflowInput as Schema, type WorkflowInput } from "@regulus/protocol";
import type { AnyGitHubEvent } from "../github/events.ts";
import { contextFromEvent, officeCommand, type WorkflowContext } from "./context.ts";
import { globRegExp, matchWorkflow } from "./match.ts";

const spec = (over: Partial<WorkflowInput>) =>
  Schema.parse({
    name: "w",
    trigger: { kind: "pull_request", actions: ["opened"] },
    henchman: { provider: "claude-code", promptTemplate: "x" },
    ...over,
  });

const repository = { name: "hello", full_name: "octo/hello", owner: { login: "octo" } };

function event(name: string, payload: Record<string, unknown>): AnyGitHubEvent {
  return {
    name,
    action: typeof payload.action === "string" ? payload.action : null,
    deliveryId: "d1",
    source: "webhook",
    receivedAt: 1,
    repo: { owner: "octo", name: "hello", fullName: "octo/hello" },
    repoIds: ["r1"],
    operationIds: ["f1"],
    installationId: 1,
    sender: { login: "alice", id: 1, type: "User" },
    fromOfficeApp: false,
    stale: false,
    payload: { repository, ...payload },
  } as AnyGitHubEvent;
}

const pr = (over: Record<string, unknown> = {}, action = "opened") =>
  contextFromEvent(
    event("pull_request", {
      action,
      pull_request: {
        number: 3,
        title: "T",
        body: "B",
        draft: false,
        user: { login: "alice", type: "User" },
        labels: [{ name: "Backend" }],
        base: { ref: "main", repo: { full_name: "octo/hello" } },
        head: { ref: "x", sha: "abc", repo: { full_name: "octo/hello" } },
        ...over,
      },
    }),
  );

describe("globs", () => {
  test("* stays in a segment, ** crosses, **/ may be empty", () => {
    expect(globRegExp("src/*.ts").test("src/a.ts")).toBe(true);
    expect(globRegExp("src/*.ts").test("src/x/a.ts")).toBe(false);
    expect(globRegExp("src/**").test("src/x/a.ts")).toBe(true);
    expect(globRegExp("src/**/a.ts").test("src/a.ts")).toBe(true);
    expect(globRegExp("release/?").test("release/1")).toBe(true);
    expect(globRegExp("a.b").test("axb")).toBe(false);
    expect(globRegExp("needs-*", true).test("NEEDS-work")).toBe(true);
  });
});

describe("triggers", () => {
  test("pull_request actions", () => {
    expect(matchWorkflow(spec({}), pr()).matched).toBe(true);
    const sync = matchWorkflow(spec({}), pr({}, "synchronize"));
    expect(sync.matched).toBe(false);
    expect(sync.reasons[0]).toContain("synchronize");
  });

  test("commands in comments and reviews, on any line", () => {
    expect(officeCommand("thanks!\n  /office review please")).toBe("review");
    expect(officeCommand("see /office review")).toBeNull();
    const comment = contextFromEvent(
      event("issue_comment", {
        action: "created",
        issue: { number: 3, title: "T", pull_request: {}, user: { login: "alice" } },
        comment: { body: "/office review", user: { login: "olga" } },
      }),
    );
    const cmd = spec({ trigger: { kind: "command", command: "review" } });
    expect(matchWorkflow(cmd, comment).matched).toBe(true);
    expect(
      matchWorkflow(spec({ trigger: { kind: "command", command: "fix" } }), comment).matched,
    ).toBe(false);
    const edited = { ...comment, action: "edited" };
    expect(matchWorkflow(cmd, edited).matched).toBe(false);
  });

  test("issues, failed checks, pushes, schedules", () => {
    const issue = contextFromEvent(
      event("issues", {
        action: "labeled",
        issue: { number: 4, title: "I", user: { login: "b" } },
      }),
    );
    expect(
      matchWorkflow(spec({ trigger: { kind: "issues", actions: ["labeled"] } }), issue).matched,
    ).toBe(true);
    const check = (conclusion: string) =>
      contextFromEvent(
        event("check_suite", {
          action: "completed",
          check_suite: {
            conclusion,
            head_sha: "abc",
            head_branch: "main",
            pull_requests: [{ number: 3 }],
          },
          sender: { login: "github-actions[bot]", type: "Bot" },
        }),
      );
    const failed = spec({ trigger: { kind: "check_failed" } });
    expect(matchWorkflow(failed, check("failure")).matched).toBe(true);
    expect(matchWorkflow(failed, check("success")).matched).toBe(false);
    expect(check("failure").check?.prNumbers).toEqual([3]);
    const push = (ref: string, after = "abc") =>
      contextFromEvent(
        event("push", {
          ref,
          after,
          pusher: { name: "alice" },
          commits: [{ added: ["a.ts"], modified: ["src/b.ts"], removed: [] }],
        }),
      );
    const onMain = spec({ trigger: { kind: "push", branches: ["main", "release/*"] } });
    expect(matchWorkflow(onMain, push("refs/heads/release/1")).matched).toBe(true);
    expect(matchWorkflow(onMain, push("refs/heads/dev")).matched).toBe(false);
    expect(matchWorkflow(onMain, push("refs/heads/main", "0".repeat(40))).matched).toBe(false);
    expect(push("refs/heads/main").files).toEqual(["a.ts", "src/b.ts"]);
    const sched = { ...push("refs/heads/main"), name: "schedule" } as WorkflowContext;
    expect(
      matchWorkflow(spec({ trigger: { kind: "schedule", cron: "0 * * * *" } }), sched).matched,
    ).toBe(true);
  });
});

describe("filters", () => {
  test("base branch, labels (case-insensitive), authors, bots, drafts", () => {
    const f = (filters: object) => spec({ filters: filters as WorkflowInput["filters"] });
    expect(matchWorkflow(f({ baseBranches: ["main"] }), pr()).matched).toBe(true);
    expect(matchWorkflow(f({ baseBranches: ["release/*"] }), pr()).matched).toBe(false);
    expect(matchWorkflow(f({ labels: { include: ["backend"] } }), pr()).matched).toBe(true);
    expect(matchWorkflow(f({ labels: { include: ["frontend"] } }), pr()).matched).toBe(false);
    expect(matchWorkflow(f({ labels: { exclude: ["back*"] } }), pr()).matched).toBe(false);
    expect(matchWorkflow(f({ authors: { exclude: ["ALICE"] } }), pr()).matched).toBe(false);
    expect(matchWorkflow(f({ repoIds: ["other"] }), pr()).matched).toBe(false);
    const bot = pr({ user: { login: "dependabot[bot]", type: "Bot" } });
    expect(matchWorkflow(f({}), bot).reasons).toEqual(["bot authors are excluded"]);
    expect(matchWorkflow(f({ bots: "include" }), bot).matched).toBe(true);
    expect(matchWorkflow(f({ bots: "only" }), pr()).matched).toBe(false);
    const draft = pr({ draft: true });
    expect(matchWorkflow(f({}), draft).matched).toBe(false);
    expect(matchWorkflow(f({ drafts: "include" }), draft).matched).toBe(true);
  });

  test("paths wait for the PR's files unless strict", () => {
    const paths = spec({
      filters: { paths: { include: ["src/**"], exclude: ["**/*.md"] } } as never,
    });
    const ctx = pr();
    expect(matchWorkflow(paths, ctx).matched).toBe(true);
    expect(matchWorkflow(paths, ctx, { strict: true }).reasons).toEqual(["changed files unknown"]);
    expect(matchWorkflow(paths, { ...ctx, files: ["src/a.ts"] }, { strict: true }).matched).toBe(
      true,
    );
    expect(matchWorkflow(paths, { ...ctx, files: ["docs/a.ts"] }, { strict: true }).matched).toBe(
      false,
    );
    expect(
      matchWorkflow(paths, { ...ctx, files: ["src/README.md"] }, { strict: true }).matched,
    ).toBe(false);
  });

  test("forks are recognised, including a deleted head repo", () => {
    expect(pr().pr?.fork).toBe(false);
    expect(pr({ head: { ref: "x", sha: "a", repo: { full_name: "evil/hello" } } }).pr?.fork).toBe(
      true,
    );
    expect(pr({ head: { ref: "x", sha: "a", repo: null } }).pr?.fork).toBe(true);
  });
});
