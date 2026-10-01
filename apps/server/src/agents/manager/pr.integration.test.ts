/**
 * `agent.pr`, `agent.worktree` and `agent.sendHome` end to end: a real agent
 * worktree (#31, local bare remote over file://), a fake GitHub REST server
 * on port 0, the FakeAdapter over LocalTmuxRunner, and the OperationRoom's
 * command path (`operationAgentCommands`). Skipped without tmux.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeAdapter } from "@regulus/agent-adapters";
import { eq } from "drizzle-orm";
import { agents } from "../../db/schema/index.ts";
import type { AgentControlOutcome } from "../../rooms/operation/room.ts";
import { hasTmux, LocalTmuxRunner } from "../../runners/testing/local-tmux-runner.ts";
import {
  commitIn,
  FAKE_PAT,
  fakeGitHub,
  git,
  type RecordedRequest,
  setupOperation,
} from "../../worktrees/test-helpers.ts";
import { operationAgentCommands } from "./commands.ts";
import { FAKE_AGENT, makeManager } from "./test-helpers.ts";

let root: string;
let runner: LocalTmuxRunner;
let github: ReturnType<typeof fakeGitHub> | undefined;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "office-agent-pr-"));
});
afterEach(async () => {
  github?.stop();
  github = undefined;
  await runner?.dispose();
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

async function agentOnOperation(respond: (req: RecordedRequest) => Response) {
  github = fakeGitHub(respond);
  const f = await setupOperation(root, { apiBase: github.url });
  runner = await LocalTmuxRunner.create();
  const adapter = new FakeAdapter({
    command: ["sh", FAKE_AGENT],
    script: [{ kind: "status", ts: 1, status: "idle" }],
  });
  const { manager, henchmen } = makeManager(f.db, runner, [adapter], {
    workspaces: f.worktrees.workspaces,
    clones: f.worktrees.workspaces,
    worktreeTools: {
      status: (id) => f.worktrees.workspaces.status(id),
      openPullRequest: (id, opts) => f.worktrees.openPullRequest(id, opts),
    },
  });
  const { agentId } = await manager.spawn(f.owner, {
    operationId: f.operationId,
    repoId: f.repo.repoId,
    provider: "custom",
    model: "fake-1",
    prompt: "fix the login",
    taskTitle: "Fix the login",
    autoWorktree: true,
  });
  await henchmen.waitFor(agentId, (r) => r.status === "idle");
  const row = f.db.select().from(agents).where(eq(agents.id, agentId)).get();
  if (!row?.worktreeBranch) throw new Error("no worktree");
  const commands = operationAgentCommands(manager);
  const actor = { id: f.owner.id, role: f.owner.role };
  const control = (command: Parameters<NonNullable<typeof commands.control>>[1]) =>
    commands.control?.(actor, command) as Promise<AgentControlOutcome>;
  return {
    f,
    manager,
    henchmen,
    agentId,
    workdir: row.workdir,
    branch: row.worktreeBranch,
    control,
  };
}

const created = (number: number) =>
  Response.json(
    { number, html_url: `https://github.com/octo/hello/pull/${number}`, draft: true },
    { status: 201 },
  );

describe.skipIf(!hasTmux())("agent.pr / agent.worktree / agent.sendHome", () => {
  test("a dirty worktree is refused with its files, then the PR opens and the henchman shows it", async () => {
    const { manager, henchmen, agentId, workdir, branch, control } = await agentOnOperation(() =>
      created(12),
    );
    await commitIn(workdir, "login.ts", "Fix login");
    await writeFile(join(workdir, "notes.txt"), "scratch\n");

    const status = await control({ type: "agent.worktree", agentId });
    expect(status).toEqual({
      ok: true,
      result: { type: "agent.worktree", agentId, worktree: { branch, uncommitted: ["notes.txt"] } },
    });

    const refused = await control({ type: "agent.pr", agentId, draft: true });
    expect(refused).toMatchObject({
      ok: false,
      reason: expect.stringContaining("uncommitted"),
      files: ["notes.txt"],
    });
    expect(github?.requests).toHaveLength(0);

    await rm(join(workdir, "notes.txt"));
    const opened = await control({ type: "agent.pr", agentId, draft: true, title: "Login fix" });
    expect(opened).toEqual({
      ok: true,
      result: {
        type: "agent.pr",
        agentId,
        pr: {
          number: 12,
          url: "https://github.com/octo/hello/pull/12",
          draft: true,
          created: true,
          branch,
        },
      },
    });
    const post = github?.requests[0];
    expect(post?.body).toMatchObject({ title: "Login fix", draft: true, head: branch });
    expect(post?.headers.get("authorization")).toBe(`Bearer ${FAKE_PAT}`);
    await henchmen.waitFor(agentId, (r) => r.prNumber === 12);
    // The result never carries the token.
    expect(JSON.stringify(opened)).not.toContain(FAKE_PAT);
    await manager.close();
  }, 30_000);

  test("an existing PR is returned; no commits is a clear refusal", async () => {
    const { manager, agentId, workdir, control } = await agentOnOperation((req) =>
      req.method === "POST"
        ? Response.json(
            {
              message: "Validation Failed",
              errors: [{ message: "A pull request already exists for octo:office/fix-the-login." }],
            },
            { status: 422 },
          )
        : Response.json([
            { number: 5, html_url: "https://github.com/octo/hello/pull/5", draft: false },
          ]),
    );
    expect(await control({ type: "agent.pr", agentId, draft: false })).toMatchObject({
      ok: false,
      reason: expect.stringContaining("no commits"),
    });
    await commitIn(workdir, "a.ts", "Work");
    expect(await control({ type: "agent.pr", agentId, draft: false })).toMatchObject({
      ok: true,
      result: { pr: { number: 5, created: false } },
    });
    await manager.close();
  }, 30_000);

  test("send home deletes the branch, or keeps it", async () => {
    const first = await agentOnOperation(() => created(1));
    await commitIn(first.workdir, "a.ts", "Work");
    expect(
      await first.control({ type: "agent.pr", agentId: first.agentId, draft: false }),
    ).toMatchObject({ ok: true });
    const bare = first.f.bare;
    expect(await git(["branch", "--list", first.branch], bare)).toContain(first.branch);
    expect(
      await first.control({ type: "agent.sendHome", agentId: first.agentId, keepBranch: false }),
    ).toEqual({ ok: true, result: { type: "agent.sendHome", agentId: first.agentId } });
    expect(first.henchmen.removed).toEqual([first.agentId]);
    expect(await git(["branch", "--list", first.branch], bare)).toBe("");
    expect(await git(["branch", "--list", first.branch], first.f.cloneOf())).toBe("");
    await first.manager.close();
    await runner.dispose();

    const second = await agentOnOperation(() => created(2));
    await commitIn(second.workdir, "b.ts", "More");
    expect(
      await second.control({ type: "agent.sendHome", agentId: second.agentId, keepBranch: true }),
    ).toMatchObject({ ok: true });
    expect(await git(["branch", "--list", second.branch], second.f.cloneOf())).toContain(
      second.branch,
    );
    await second.manager.close();
  }, 40_000);
});
