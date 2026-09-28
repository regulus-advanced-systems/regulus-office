/**
 * Robot controls (#33) through `floorAgentCommands(manager).control`, the
 * same path the FloorRoom uses: the D12 ACL for every command, pending
 * permission requests (published for controllers, answered once, cleared,
 * expired), interrupt / stop / resume, and send-home keeping or deleting the
 * branch. Runs the FakeAdapter over LocalTmuxRunner; skipped without tmux.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { FakeAdapter } from "@regulus/agent-adapters";
import type { AgentCommandResult } from "@regulus/protocol";
import type { AgentControlCommand, AgentControlOutcome } from "../../rooms/floor/room.ts";
import { hasTmux, LocalTmuxRunner } from "../../runners/testing/local-tmux-runner.ts";
import type { Workspaces } from "../../worktrees/types.ts";
import { floorAgentCommands } from "./commands.ts";
import type { AgentManagerOptions } from "./manager.ts";
import { FAKE_AGENT, makeManager, officeFixture, spawnInput } from "./test-helpers.ts";

type Office = Awaited<ReturnType<typeof officeFixture>>;

const fakeAdapter = (permissionResolution = false) =>
  new FakeAdapter({
    command: ["sh", FAKE_AGENT],
    providerSessionId: "sess-1",
    script: [{ kind: "status", ts: 1, status: "idle" }],
    permissionResolution,
  });

const permissionRequest = (requestId: string) => ({
  kind: "permission_request" as const,
  ts: Date.now(),
  requestId,
  toolName: "Bash",
  description: "Bash: rm -rf build",
  options: ["allow_once" as const, "reject" as const],
});

class RecordingWorkspaces implements Workspaces {
  readonly released: { agentId: string; keepBranch: boolean }[] = [];
  async prepare() {
    return { workdir: "/unused", branch: "office/unused" };
  }
  async release(input: { agentId: string; keepBranch: boolean }) {
    this.released.push(input);
  }
}

describe.skipIf(!hasTmux())("robot controls (tmux)", () => {
  let runner: LocalTmuxRunner;
  let office: Office;

  beforeEach(async () => {
    runner = await LocalTmuxRunner.create();
    office = await officeFixture();
  });

  afterEach(async () => {
    await runner.dispose();
    await rm(office.workdir, { recursive: true, force: true });
  });

  async function setup(
    extra: Partial<AgentManagerOptions> = {},
    opts: { permissionResolution?: boolean } = {},
  ) {
    const adapter = fakeAdapter(opts.permissionResolution);
    const workspaces = new RecordingWorkspaces();
    const { manager, robots } = makeManager(office.db, runner, [adapter], {
      workspaces,
      worktreeTools: {
        status: async () => ({ branch: "office/fix", uncommitted: ["src/a.ts"] }),
        openPullRequest: async (_id, opts) => ({
          number: 7,
          url: "https://github.com/octo/hello/pull/7",
          draft: opts.draft ?? false,
          created: true,
          branch: "office/fix",
        }),
      },
      ...extra,
    });
    const { agentId } = await manager.spawn(
      office.member,
      spawnInput(office.floorId, office.repoId),
    );
    await robots.waitFor(agentId, (r) => r.status === "idle");
    const commands = floorAgentCommands(manager);
    const control = (actor: { id: string; role: string }, command: AgentControlCommand) =>
      commands.control?.(actor as never, command) as Promise<AgentControlOutcome>;
    return { adapter, workspaces, manager, robots, agentId, control };
  }

  const ok = (outcome: AgentControlOutcome): AgentCommandResult => {
    if (!outcome.ok) throw new Error(`rejected: ${outcome.reason}`);
    return outcome.result;
  };

  test("every control follows D12: owner, admin and the robot's owner; not others or viewers", async () => {
    const { manager, agentId, control, adapter } = await setup();
    const commands: AgentControlCommand[] = [
      { type: "agent.prompt", agentId, text: "go" },
      { type: "agent.approve", agentId, requestId: "p1", decision: "allow_once" },
      { type: "agent.interrupt", agentId },
      { type: "agent.stop", agentId },
      { type: "agent.resume", agentId },
      { type: "agent.sendHome", agentId, keepBranch: true },
      { type: "agent.pr", agentId, draft: false },
      { type: "agent.worktree", agentId },
    ];
    for (const who of [office.stranger, office.viewer, office.roleViewer]) {
      for (const command of commands) {
        const outcome = await control(who, command);
        expect(outcome).toEqual({
          ok: false,
          reason: "only the robot's owner or an admin may control it",
          files: [],
        });
      }
    }
    expect(adapter.lastControl?.prompts).toHaveLength(1); // only the spawn prompt

    for (const who of [office.member, office.admin, office.owner]) {
      expect(
        ok(await control(who, { type: "agent.prompt", agentId, text: `hi ${who.id}` })),
      ).toEqual({ type: "agent.prompt", agentId });
      expect(ok(await control(who, { type: "agent.worktree", agentId }))).toEqual({
        type: "agent.worktree",
        agentId,
        worktree: { branch: "office/fix", uncommitted: ["src/a.ts"] },
      });
    }
    expect(adapter.lastControl?.prompts.map((p) => p.text).slice(1)).toEqual([
      `hi ${office.member.id}`,
      `hi ${office.admin.id}`,
      `hi ${office.owner.id}`,
    ]);
    await manager.close();
  }, 20_000);

  test("permission requests are published for controllers, answered once, then cleared", async () => {
    const { manager, robots, agentId, control, adapter } = await setup();
    const fake = adapter.lastControl;
    if (!fake) throw new Error("no control");
    fake.emit(permissionRequest("p1"));
    await robots.waitFor(agentId, (r) => r.handRaised);
    const pending = robots.permissions.get(agentId);
    expect(pending).toHaveLength(1);
    expect(pending?.[0]).toMatchObject({
      requestId: "p1",
      toolName: "Bash",
      description: "Bash: rm -rf build",
      options: ["allow_once", "reject"],
    });
    expect(robots.permissionHistory.at(-1)?.ownerUserId).toBe(office.member.id);
    // Nothing about the request is in the public robot.
    expect(JSON.stringify(robots.robots.get(agentId))).not.toContain("rm -rf");

    const refused = await control(office.stranger, {
      type: "agent.approve",
      agentId,
      requestId: "p1",
      decision: "allow_once",
    });
    expect(refused.ok).toBe(false);
    expect(fake.permissionResponses).toEqual([]);

    expect(
      ok(
        await control(office.member, {
          type: "agent.approve",
          agentId,
          requestId: "p1",
          decision: "allow_once",
        }),
      ),
    ).toEqual({ type: "agent.approve", agentId, requestId: "p1" });
    expect(fake.permissionResponses).toEqual([{ id: "p1", decision: "allow_once" }]);
    expect(robots.permissions.get(agentId)).toEqual([]);
    await robots.waitFor(agentId, (r) => !r.handRaised);

    // Answered already (or in the terminal): refused with a hint.
    const again = await control(office.member, {
      type: "agent.approve",
      agentId,
      requestId: "p1",
      decision: "reject",
    });
    expect(again).toMatchObject({ ok: false, reason: expect.stringContaining("terminal") });

    // The agent moving on clears what is left.
    fake.emit(permissionRequest("p2"));
    await robots.waitFor(agentId, (r) => r.handRaised);
    expect(robots.permissions.get(agentId)).toHaveLength(1);
    fake.emit({ kind: "status", ts: Date.now(), status: "working" });
    await robots.waitFor(agentId, (r) => r.status === "working");
    expect(robots.permissions.get(agentId)).toEqual([]);
    await manager.close();
  }, 20_000);

  test("parallel requests (Codex-style): answering one keeps the other visible", async () => {
    const { manager, robots, agentId, control, adapter } = await setup(
      {},
      { permissionResolution: true },
    );
    const fake = adapter.lastControl;
    if (!fake) throw new Error("no control");
    fake.emit(permissionRequest("p1"));
    fake.emit(permissionRequest("p2"));
    await robots.waitFor(agentId, (r) => r.handRaised);
    const deadline = Date.now() + 2000;
    while ((robots.permissions.get(agentId)?.length ?? 0) < 2 && Date.now() < deadline) {
      await Bun.sleep(10);
    }
    expect(robots.permissions.get(agentId)?.map((r) => r.requestId)).toEqual(["p1", "p2"]);

    ok(
      await control(office.member, {
        type: "agent.approve",
        agentId,
        requestId: "p1",
        decision: "allow_once",
      }),
    );
    // The fake, like Codex, reports `working` after an answer: p2 must survive it.
    await robots.waitFor(agentId, (r) => r.status === "working");
    await Bun.sleep(50);
    expect(robots.permissions.get(agentId)?.map((r) => r.requestId)).toEqual(["p2"]);
    expect(robots.permissionHistory.at(-1)).toEqual({
      agentId,
      ownerUserId: office.member.id,
      count: 1,
    });

    // The provider clears the other one itself (turn ended): gone for controllers too.
    fake.cancelPermission("p2");
    expect(robots.permissions.get(agentId)).toEqual([]);
    expect(fake.permissionResponses).toEqual([{ id: "p1", decision: "allow_once" }]);
    await manager.close();
  }, 20_000);

  test("unanswered requests expire", async () => {
    const { manager, robots, agentId, adapter } = await setup({ permissionTtlMs: 60 });
    adapter.lastControl?.emit(permissionRequest("p1"));
    await robots.waitFor(agentId, (r) => r.handRaised);
    expect(robots.permissions.get(agentId)?.[0]?.expiresAt).toBeGreaterThan(0);
    const deadline = Date.now() + 2000;
    while ((robots.permissions.get(agentId)?.length ?? 1) > 0 && Date.now() < deadline) {
      await Bun.sleep(10);
    }
    expect(robots.permissions.get(agentId)).toEqual([]);
    await manager.close();
  }, 20_000);

  test("interrupt, stop and resume", async () => {
    const { manager, robots, agentId, control, adapter } = await setup();
    ok(await control(office.member, { type: "agent.interrupt", agentId }));
    expect(adapter.lastControl?.interrupts).toBe(1);

    ok(await control(office.admin, { type: "agent.stop", agentId }));
    expect(robots.robots.get(agentId)?.status).toBe("exited");
    expect(
      await control(office.member, { type: "agent.prompt", agentId, text: "x" }),
    ).toMatchObject({ ok: false, reason: "the agent is not running" });

    ok(await control(office.member, { type: "agent.resume", agentId }));
    expect(adapter.spawns.at(-1)?.resumeSessionId).toBe("sess-1");
    await robots.waitFor(agentId, (r) => r.status === "idle");
    expect(await control(office.member, { type: "agent.resume", agentId })).toMatchObject({
      ok: false,
      reason: "the agent is still running",
    });
    await manager.close();
  }, 20_000);

  test("send home releases the workspace keeping or deleting the branch", async () => {
    const { manager, robots, agentId, control, workspaces, adapter } = await setup();
    adapter.lastControl?.emit(permissionRequest("p1"));
    await robots.waitFor(agentId, (r) => r.handRaised);
    ok(await control(office.member, { type: "agent.sendHome", agentId, keepBranch: false }));
    expect(workspaces.released).toEqual([{ agentId, keepBranch: false }]);
    expect(robots.removed).toEqual([agentId]);
    expect(robots.permissions.get(agentId)).toEqual([]);
    expect(await control(office.member, { type: "agent.stop", agentId })).toMatchObject({
      ok: false,
      reason: "no such agent",
    });

    const second = await manager.spawn(office.member, spawnInput(office.floorId, office.repoId));
    await robots.waitFor(second.agentId, (r) => r.status === "idle");
    ok(
      await control(office.owner, {
        type: "agent.sendHome",
        agentId: second.agentId,
        keepBranch: true,
      }),
    );
    expect(workspaces.released.at(-1)).toEqual({ agentId: second.agentId, keepBranch: true });
    await manager.close();
  }, 20_000);

  test("PR and worktree commands need the worktree tools", async () => {
    const { manager, agentId, control } = await setup({ worktreeTools: undefined });
    expect(await control(office.member, { type: "agent.pr", agentId, draft: true })).toMatchObject({
      ok: false,
      reason: "worktrees are not available",
    });
    await manager.close();

    const withTools = await setup();
    const pr = ok(
      await withTools.control(office.member, {
        type: "agent.pr",
        agentId: withTools.agentId,
        draft: true,
      }),
    );
    expect(pr).toMatchObject({ type: "agent.pr", pr: { number: 7, draft: true } });
    await withTools.robots.waitFor(withTools.agentId, (r) => r.prNumber === 7);
    await withTools.manager.close();
  }, 20_000);
});
