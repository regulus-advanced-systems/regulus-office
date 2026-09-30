/**
 * Workflow runs end to end (#155): a signed webhook → the #35 event bus → the
 * engine → a throwaway checkout of the PR head → the fake `claude` from the
 * agents e2e (print mode) in the workflow runner → its review posted to the
 * fake GitHub as the App. Also: loop protection and redelivery, fork PRs,
 * command permissions, and the office key requirement.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { type WorkflowInput, WorkflowInput as WorkflowInputSchema } from "@regulus/protocol";
import { eq, isNull } from "drizzle-orm";
import { auditLog, usageSamples, workflowRuns } from "../db/schema/index.ts";
import { hasTmux } from "../runners/testing/local-tmux-runner.ts";
import { OFFICE_MARKER } from "./context.ts";
import {
  APP_SLUG,
  FLOOR_ID,
  OFFICE_KEY,
  prPayload,
  repository,
  type WorkflowFixture,
  workflowFixture,
} from "./testing/fixture.ts";
import { WORKFLOW_RUNNER_USER } from "./workspace.ts";

let f: WorkflowFixture;
afterEach(async () => {
  await f?.stop();
});

const spec = (over: Partial<WorkflowInput> = {}) =>
  WorkflowInputSchema.parse({
    name: "Review PRs",
    enabled: true,
    trigger: { kind: "pull_request", actions: ["opened", "synchronize"] },
    robot: { provider: "claude-code", promptTemplate: "Review {{pr.title}}\n{{diff}}" },
    actions: {
      review: { enabled: true, allowRequestChanges: true },
      label: { enabled: true, allowed: ["needs-*"] },
      checkRun: { enabled: true },
    },
    limits: { cooldownMinutes: 0 },
    ...over,
  });

const runs = () => f.db.select().from(workflowRuns).all();
const printArgs = async () =>
  Bun.file(join(f.runner.dir, "home", WORKFLOW_RUNNER_USER, "fake-claude-print.args")).text();

describe.skipIf(!hasTmux())("workflow review runs", () => {
  test("a new PR gets a review from the App, read-only, on the office key", async () => {
    f = await workflowFixture();
    f.addOfficeKey();
    const wf = f.workflows.store.create(FLOOR_ID, spec(), null);
    const res = await f.deliver("pull_request", prPayload("opened", f.remote.headSha));
    expect(res.status).toBe(202);
    await f.workflows.engine.idle();

    const [run] = runs();
    expect(run?.status).toBe("succeeded");
    expect(run?.workflowId).toBe(wf.id);
    expect(run?.inputTokens).toBe(1200);
    const kinds = f.wf.writes.map((w) => w.kind);
    expect(kinds).toEqual(["check_run", "review", "labels", "check_run_update"]);
    // Every write used an installation token minted for this repo.
    for (const w of f.wf.writes) expect(f.gh.minted.get(w.token)?.repo).toBe("hello");

    const review = f.wf.writes.find((w) => w.kind === "review")?.body as {
      body: string;
      event: string;
      commit_id: string;
      comments: { path: string; line: number; side: string; body: string }[];
    };
    expect(review.event).toBe("REQUEST_CHANGES");
    expect(review.commit_id).toBe(f.remote.headSha);
    expect(review.comments).toEqual([
      { path: "src/app.ts", line: 2, side: "RIGHT", body: "Fake inline note" },
    ]);
    expect(review.body).toContain("via Regulus Office");
    expect(review.body).toContain(OFFICE_MARKER);
    // The robot's probes: no writes, nothing to push to, no GitHub token, the office key.
    expect(review.body).toContain("write: denied, push: denied, remotes: 0");
    expect(review.body).toContain("github tokens in env: 0, model key: yes");
    expect(review.body).not.toContain("@octocat");
    expect(review.body).toContain("not-in-diff.txt:999");
    const labels = f.wf.writes.find((w) => w.kind === "labels")?.body;
    expect(labels).toEqual({ labels: ["needs-work"] });
    const check = f.wf.writes.find((w) => w.kind === "check_run_update")?.body;
    expect(check?.conclusion).toBe("neutral");

    // Read-only tools, no project settings or MCP, nothing that could run code.
    const args = await printArgs();
    expect(args).toContain("--tools\nRead,Grep,Glob\n");
    expect(args).toContain("--permission-mode\ndontAsk\n");
    expect(args).toContain("--setting-sources\nuser\n");
    expect(args).toContain("--strict-mcp-config\n");
    expect(args).toMatch(/--disallowedTools\n[^\n]*Bash/);

    // Usage is the office's; every GitHub write is audited; the checkout is gone.
    const usage = f.db.select().from(usageSamples).where(isNull(usageSamples.userId)).all();
    expect(usage.map((u) => [u.provider, u.inputTokens, u.outputTokens])).toEqual([
      ["claude-code", 1200, 340],
    ]);
    const audits = f.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, "workflow_run.github_write"))
      .all()
      .map((a) => JSON.parse(a.metaJson).kind);
    expect(audits.sort()).toEqual(["check_run", "labels", "review"]);
    const area = join(f.worktreesDir, "hello", WORKFLOW_RUNNER_USER);
    expect((await readdir(area)).filter((n) => n.startsWith("wf-"))).toEqual([]);
    // No key or token in any log line or the run log.
    const text = f.logs.join("\n") + JSON.stringify(runs());
    expect(text).not.toContain(OFFICE_KEY);
    expect(text).not.toMatch(/ghs_fakeInstallationToken/);
  });

  test("redeliveries and the App's own events never run again", async () => {
    f = await workflowFixture();
    f.addOfficeKey();
    f.workflows.store.create(
      FLOOR_ID,
      spec({ trigger: { kind: "command", command: "review" } }),
      null,
    );
    f.workflows.store.create(FLOOR_ID, spec(), null);
    const id = crypto.randomUUID();
    await f.deliver("pull_request", prPayload("opened", f.remote.headSha), id);
    expect(
      (await f.deliver("pull_request", prPayload("opened", f.remote.headSha), id)).status,
    ).toBe(200);
    await f.workflows.engine.idle();
    expect(runs()).toHaveLength(1);
    // Pushed by the office's App (a fix robot later), and a comment the office posted.
    const bot = { login: `${APP_SLUG}[bot]`, id: 9, type: "Bot" };
    await f.deliver("pull_request", prPayload("synchronize", f.remote.headSha, { sender: bot }));
    await f.deliver("issue_comment", {
      action: "created",
      issue: { number: 7, title: "Add b", pull_request: {}, user: { login: "alice" } },
      comment: { body: `/office review\n${OFFICE_MARKER}`, user: { login: "olga", type: "User" } },
      repository,
      sender: { login: "olga", id: 3, type: "User" },
    });
    await f.workflows.engine.idle();
    expect(runs()).toHaveLength(1);
    expect(f.wf.writes.filter((w) => w.kind === "review")).toHaveLength(1);
  });

  test("fork PRs: a comment review only, no labels, no code execution", async () => {
    f = await workflowFixture({
      pulls: (headSha) => [
        {
          number: 7,
          title: "Add b",
          base: "main",
          head: "feature/b",
          headSha,
          headRepo: "mallory/hello",
          files: ["src/app.ts"],
        },
      ],
    });
    f.addOfficeKey();
    const base = spec();
    f.workflows.store.create(
      FLOOR_ID,
      { ...base, robot: { ...base.robot, executePrCode: true } },
      null,
    );
    await f.deliver(
      "pull_request",
      prPayload("opened", f.remote.headSha, { headRepo: "mallory/hello" }),
    );
    await f.workflows.engine.idle();
    expect(runs()[0]?.status).toBe("succeeded");
    const review = f.wf.writes.find((w) => w.kind === "review")?.body;
    expect(review?.event).toBe("COMMENT");
    expect(f.wf.writes.some((w) => w.kind === "labels")).toBe(false);
    const args = await printArgs();
    expect(args).toContain("--tools\nRead,Grep,Glob\n");
    expect(JSON.parse(runs()[0]?.logJson ?? "[]").join("\n")).toContain("fork PR: read-only");
  });

  test("commands need write access to the repo; runs need the office key", async () => {
    f = await workflowFixture();
    f.workflows.store.create(
      FLOOR_ID,
      spec({ trigger: { kind: "command", command: "review" } }),
      null,
    );
    const comment = (login: string) => ({
      action: "created",
      issue: { number: 7, title: "Add b", pull_request: {}, user: { login: "alice" } },
      comment: { body: "Please\n/office review", user: { login, type: "User" } },
      repository,
      sender: { login, id: 3, type: "User" },
    });
    await f.deliver("issue_comment", comment("rita"));
    await f.workflows.engine.idle();
    expect(runs()[0]?.status).toBe("refused");
    expect(runs()[0]?.reason).toStartWith("command_needs_write");

    await f.deliver("issue_comment", comment("olga"));
    await f.workflows.engine.idle();
    const second = runs().find((r) => r.id !== runs()[0]?.id);
    expect(second?.status).toBe("refused");
    expect(second?.reason).toStartWith("office_key_required");
    expect(f.wf.writes).toEqual([]);

    f.addOfficeKey();
    await f.deliver("issue_comment", comment("olga"));
    await f.workflows.engine.idle();
    expect(runs().filter((r) => r.status === "succeeded")).toHaveLength(1);
    expect(f.wf.writes.map((w) => w.kind)).toContain("review");
  });
});
