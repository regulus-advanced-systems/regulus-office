/** Workflow REST (#155): who may read and edit, approve and fix rules, dry run, run history. */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  WORKFLOW_EVENTS_API_PATH,
  WORKFLOW_RUNS_API_PATH,
  WORKFLOWS_API_PATH,
  type WorkflowDryRunResult,
  type WorkflowListResponse,
  type WorkflowView,
  workflowDryRunPath,
  workflowPath,
  workflowRunCancelPath,
  workflowRunPath,
} from "@regulus/protocol";
import { eq } from "drizzle-orm";
import { type Office, startOffice } from "../auth/test-helpers.ts";
import { auditLog, operationRepos, operations } from "../db/schema/index.ts";
import { seedGitHubLink, seedRoomMember } from "../github/access/test-snapshot.ts";
import type { RepoCheckout } from "../github/repo-access.ts";
import { createLogger } from "../logging.ts";
import type { Runner } from "../runners/types.ts";
import { UsageTracker } from "../usage/index.ts";
import type { WorkflowContext } from "./context.ts";
import { createWorkflows, type Workflows } from "./setup.ts";

let office: Office;
let workflows: Workflows;
type U = { id: string; cookie: string };
let owner: U;
let manager: U;
let spawner: U;
let stranger: U;
let admin: U;
/** An office admin with a linked GitHub account that cannot see the room's repo (#270). */
let blindAdmin: U;

const repo = {
  repoId: "r1",
  operationId: "f1",
  owner: "octo",
  name: "hello",
  isPrimary: true,
} as RepoCheckout;

beforeAll(async () => {
  office = startOffice();
  owner = await office.signUp("Olga");
  manager = await office.signUp("Mia");
  spawner = await office.signUp("Sam");
  stranger = await office.signUp("Stan");
  admin = await office.signUp("Ada");
  blindAdmin = await office.signUp("Bea");
  for (const who of [admin, blindAdmin])
    office.db.$client.run(`update user_profiles set role = 'admin' where user_id = '${who.id}'`);
  office.db
    .insert(operations)
    .values({
      id: "f1",
      name: "Hello",
      slug: "hello",
      index: 1,
      paletteId: "p",
      layoutTemplateId: "t",
    })
    .run();
  office.db
    .insert(operationRepos)
    .values({
      id: "r1",
      operationId: "f1",
      owner: "octo",
      name: "hello",
      url: "u",
      workdir: "/nope",
      isPrimary: true,
    })
    .run();
  // Each person's access is their own GitHub permission on octo/hello (#270):
  // the office owner and one admin administer it, as does the room's manager.
  for (const who of [owner, admin, manager]) seedRoomMember(office.db, who.id, "f1", "manage");
  seedRoomMember(office.db, spawner.id, "f1", "spawn");
  seedGitHubLink(office.db, blindAdmin.id);
  workflows = createWorkflows({
    db: office.db,
    keyring: undefined,
    config: { worktreesDir: "/nonexistent" },
    logger: createLogger({ level: "silent" }),
    connection: {
      app: () => null,
      tokenFor: async () => null,
      api: { json: async () => ({}) as never },
    },
    repos: { getRepo: () => repo, listOperationRepos: (f) => (f === "f1" ? [repo] : []) },
    runner: {} as Runner,
    usage: new UsageTracker(office.db),
  });
  workflows.mount(office.server.router, office.auth);
});

afterAll(async () => {
  await workflows.close();
  await office.stop();
});

const send = (path: string, method: string, who: U | null, body?: unknown, origin?: string) =>
  office.request(path, {
    method,
    cookie: who?.cookie,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: origin ? { origin } : undefined,
  });

const input = (over: Record<string, unknown> = {}) => ({
  name: "Review PRs",
  enabled: true,
  trigger: { kind: "pull_request", actions: ["opened"] },
  henchman: { provider: "claude-code", promptTemplate: "Review {{pr.title}}" },
  actions: { review: { enabled: true } },
  ...over,
});

describe("access", () => {
  test("operation members read; only admins and operation managers write", async () => {
    const list = `${WORKFLOWS_API_PATH}?operationId=f1`;
    expect((await send(list, "GET", null)).status).toBe(401);
    expect((await send(list, "GET", stranger)).status).toBe(404);
    const seen = (await (await send(list, "GET", spawner)).json()) as WorkflowListResponse;
    expect(seen.canEdit).toBe(false);
    expect(seen.missing).toContain("github_app");
    expect(
      (await send(WORKFLOWS_API_PATH, "POST", spawner, { operationId: "f1", ...input() })).status,
    ).toBe(403);
    expect(
      (await send(WORKFLOWS_API_PATH, "POST", stranger, { operationId: "f1", ...input() })).status,
    ).toBe(404);
    const cross = await send(
      WORKFLOWS_API_PATH,
      "POST",
      manager,
      { operationId: "f1", ...input() },
      "https://evil.example",
    );
    expect(cross.status).toBe(403);
    const created = await send(WORKFLOWS_API_PATH, "POST", manager, {
      operationId: "f1",
      ...input(),
    });
    expect(created.status).toBe(201);
    const wf = (await created.json()) as WorkflowView;
    expect(wf.actions.approve.enabled).toBe(false);
    expect(wf.limits.concurrency).toBe(1);
    const mine = (await (await send(list, "GET", manager)).json()) as WorkflowListResponse;
    expect(mine.canEdit).toBe(true);
    expect(mine.canApprove).toBe(false);
    expect(mine.missing).toContain("office_key:claude-code");
    expect((await send(workflowPath(wf.id), "PATCH", spawner, input({ name: "x" }))).status).toBe(
      403,
    );
    expect((await send(workflowPath(wf.id), "DELETE", stranger)).status).toBe(404);
    // An office admin whose GitHub account cannot see the repo has no room, so no workflows.
    expect((await send(list, "GET", blindAdmin)).status).toBe(404);
    expect(
      (await send(WORKFLOWS_API_PATH, "POST", blindAdmin, { operationId: "f1", ...input() }))
        .status,
    ).toBe(404);
    expect(
      (await send(workflowPath(wf.id), "PATCH", blindAdmin, input({ name: "Blind" }))).status,
    ).toBe(404);
    expect((await send(workflowPath(wf.id), "DELETE", blindAdmin)).status).toBe(404);
    // The owner edits them as an admin of the repo on GitHub, not through the office role.
    expect(
      (await send(workflowPath(wf.id), "PATCH", owner, input({ name: "Renamed" }))).status,
    ).toBe(200);
    const audits = office.db.select().from(auditLog).where(eq(auditLog.targetId, wf.id)).all();
    expect(audits.map((a) => a.action)).toEqual(["workflow.create", "workflow.update"]);
    expect((await send(workflowPath(wf.id), "DELETE", manager)).status).toBe(204);
  });

  test("approve needs an office admin; fix cannot be turned on; schedules and repos are checked", async () => {
    const approve = input({ actions: { review: { enabled: true }, approve: { enabled: true } } });
    const refused = await send(WORKFLOWS_API_PATH, "POST", manager, {
      operationId: "f1",
      ...approve,
    });
    expect(refused.status).toBe(403);
    expect((await refused.json()).error).toBe("approve_needs_admin");
    const byAdmin = await send(WORKFLOWS_API_PATH, "POST", admin, {
      operationId: "f1",
      ...approve,
    });
    expect(byAdmin.status).toBe(201);
    const wf = (await byAdmin.json()) as WorkflowView;
    // An operation manager may keep what the admin allowed, or turn it off.
    expect(
      (await send(workflowPath(wf.id), "PATCH", manager, { ...approve, name: "kept" })).status,
    ).toBe(200);
    expect((await send(workflowPath(wf.id), "PATCH", manager, input())).status).toBe(200);
    expect((await send(workflowPath(wf.id), "PATCH", manager, approve)).status).toBe(403);

    const fix = input({ actions: { fix: { enabled: true } } });
    expect(
      (await (await send(WORKFLOWS_API_PATH, "POST", admin, { operationId: "f1", ...fix })).json())
        .error,
    ).toBe("fix_not_available");
    const cron = input({ trigger: { kind: "schedule", cron: "99 * * * *" } });
    expect(
      (await (await send(WORKFLOWS_API_PATH, "POST", admin, { operationId: "f1", ...cron })).json())
        .error,
    ).toBe("invalid_cron");
    const repos = input({ filters: { repoIds: ["someone-elses"] } });
    expect(
      (
        await (
          await send(WORKFLOWS_API_PATH, "POST", admin, { operationId: "f1", ...repos })
        ).json()
      ).error,
    ).toBe("unknown_repo");
    const bad = await send(WORKFLOWS_API_PATH, "POST", admin, {
      operationId: "f1",
      ...input({ henchman: { provider: "gemini-cli", promptTemplate: "x" } }),
    });
    expect(bad.status).toBe(400);
  });
});

describe("dry run and history", () => {
  test("a dry run against a past event posts nothing and shows the prompt and rules", async () => {
    const created = (await (
      await send(WORKFLOWS_API_PATH, "POST", manager, { operationId: "f1", ...input() })
    ).json()) as WorkflowView;
    const ctx = {
      deliveryId: "evt-1",
      event: "pull_request.opened",
      name: "pull_request",
      action: "opened",
      source: "webhook",
      receivedAt: Date.now(),
      repo: { owner: "octo", name: "hello", fullName: "octo/hello" },
      repoIds: ["r1"],
      operationIds: ["f1"],
      sender: { login: "mallory", isBot: false },
      fromOfficeApp: false,
      stale: false,
      pr: {
        number: 9,
        title: "Evil",
        body: "",
        author: "mallory",
        authorIsBot: false,
        draft: false,
        state: "open",
        baseRef: "main",
        headRef: "x",
        headSha: "abc",
        headRepo: "mallory/hello",
        fork: true,
        labels: [],
        url: "",
      },
    } as WorkflowContext;
    workflows.events.record(ctx);
    const events = await (
      await send(`${WORKFLOW_EVENTS_API_PATH}?operationId=f1`, "GET", spawner)
    ).json();
    expect(events.events[0].name).toBe("pull_request.opened");
    expect(events.events[0].summary).toBe("octo/hello#9 Evil");
    const eventId = events.events[0].id as string;
    expect((await send(workflowDryRunPath(created.id), "POST", spawner, { eventId })).status).toBe(
      403,
    );
    const res = await send(workflowDryRunPath(created.id), "POST", manager, { eventId });
    expect(res.status).toBe(200);
    const dry = (await res.json()) as WorkflowDryRunResult;
    expect(dry.matched).toBe(true);
    expect(dry.prompt).toContain("Review <<<UNTRUSTED-preview\nEvil\nUNTRUSTED-preview>>>");
    expect(dry.actions).toEqual(["PR review (comment review) with inline comments"]);
    expect(dry.safety.join("\n")).toContain("fork PR");
    // An unsaved edit that no longer matches.
    const edit = input({ trigger: { kind: "pull_request", actions: ["synchronize"] } });
    const other = (await (
      await send(workflowDryRunPath(created.id), "POST", manager, { eventId, workflow: edit })
    ).json()) as WorkflowDryRunResult;
    expect(other.matched).toBe(false);

    // History: operation viewers read runs; managers cancel queued ones.
    const [runId] = workflows.engine.consider({ ...ctx, deliveryId: "evt-2" });
    const runs = await (
      await send(`${WORKFLOW_RUNS_API_PATH}?operationId=f1`, "GET", spawner)
    ).json();
    expect(runs.runs.map((r: { id: string }) => r.id)).toContain(runId);
    expect((await send(`${WORKFLOW_RUNS_API_PATH}?operationId=f1`, "GET", stranger)).status).toBe(
      404,
    );
    const detail = await (await send(workflowRunPath(runId as string), "GET", spawner)).json();
    expect(detail.workflowName).toBe("Review PRs");
    expect((await send(workflowRunCancelPath(runId as string), "POST", spawner)).status).toBe(403);
  });
});
