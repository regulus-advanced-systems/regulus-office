/**
 * AgentManager end to end over LocalTmuxRunner (private tmux socket) with
 * the FakeAdapter running the fake agent script: spawn → events → HenchmanState
 * → stop; spawn ACL; re-adoption after the manager is dropped. Skipped
 * without tmux.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { FakeAdapter } from "@regulus/agent-adapters";
import { eq } from "drizzle-orm";
import { agentEvents, agents, auditLog, desks } from "../../db/schema/index.ts";
import { hasTmux, LocalTmuxRunner } from "../../runners/testing/local-tmux-runner.ts";
import { AgentManagerError } from "./errors.ts";
import { FAKE_AGENT, makeManager, officeFixture, spawnInput } from "./test-helpers.ts";

type Office = Awaited<ReturnType<typeof officeFixture>>;

function fakeAdapter(replayIdle = true) {
  return new FakeAdapter({
    command: ["sh", FAKE_AGENT],
    providerSessionId: "sess-1",
    script: replayIdle ? [{ kind: "status", ts: 1, status: "idle" }] : [],
    onPrompt: (text, ts) => [
      { kind: "status", ts, status: "working" },
      { kind: "message", ts, role: "assistant", text: "partial", partial: true },
      {
        kind: "tool_call",
        ts,
        callId: "c1",
        name: "Edit",
        toolKind: "edit",
        status: "running",
        summary: text.slice(0, 50),
      },
    ],
  });
}

describe.skipIf(!hasTmux())("AgentManager (tmux)", () => {
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

  test("spawn runs the agent in tmux, publishes HenchmanState, persists, and stop exits", async () => {
    const adapter = fakeAdapter();
    const { manager, henchmen } = makeManager(office.db, runner, [adapter]);
    const { agentId, seatId } = await manager.spawn(
      office.member,
      spawnInput(office.operationId, office.repoId, { seatId: "seat-2", taskTitle: "Fix it" }),
    );
    expect(seatId).toBe("seat-2");

    const henchman = await henchmen.waitFor(agentId, (r) => r.bubbleEmits.toolCalls === 1);
    expect(henchman).toMatchObject({
      seatId: "seat-2",
      ownerUserId: office.member.id,
      ownerName: "Mia",
      provider: "custom",
      taskTitle: "Fix it",
      action: "editing",
      worktreeBranch: "trunk",
      bubbleEmits: { toolCalls: 1, fileEdits: 1, testRuns: 0, toolFailures: 0 },
    });
    expect(henchmen.history[0]?.status).toBe("starting");
    expect(adapter.lastControl?.prompts.map((p) => p.text)).toEqual(["hello henchman"]);

    const row = office.db.select().from(agents).where(eq(agents.id, agentId)).get();
    expect(row).toMatchObject({
      status: "working",
      tmuxSession: `agent-${agentId}`,
      providerSessionId: "sess-1",
      workdir: office.workdir,
      deskSeatId: "seat-2",
    });
    expect(row?.hookTokenHash).toMatch(/^[0-9a-f]{64}$/);
    const kinds = office.db
      .select({ kind: agentEvents.kind })
      .from(agentEvents)
      .where(eq(agentEvents.agentId, agentId))
      .all()
      .map((e) => e.kind);
    expect(kinds).toContain("tool_call");
    expect(kinds).not.toContain("message"); // partial deltas are not persisted
    expect(await runner.sessionExists({ userId: office.member.id, name: `agent-${agentId}` })).toBe(
      true,
    );

    await expect(manager.stop(office.stranger, agentId)).rejects.toThrow(AgentManagerError);
    await manager.stop(office.member, agentId);
    expect(henchmen.henchmen.get(agentId)?.status).toBe("exited");
    expect(await runner.sessionExists({ userId: office.member.id, name: `agent-${agentId}` })).toBe(
      false,
    );
    const stopped = office.db.select().from(agents).where(eq(agents.id, agentId)).get();
    expect(stopped?.status).toBe("exited");
    expect(stopped?.exitedAt).not.toBeNull();
    expect(stopped?.hookTokenHash).toBeNull();

    // Late events cannot revive an exited henchman.
    manager.publish(agentId, { kind: "status", ts: Date.now(), status: "working" });
    expect(henchmen.henchmen.get(agentId)?.status).toBe("exited");

    // Office owners watch other people's henchmen; only the henchman's owner sends it home (#138).
    await expect(manager.sendHome(office.owner, agentId, { keepBranch: true })).rejects.toThrow(
      "only the henchman's owner may control it",
    );
    await manager.sendHome(office.member, agentId, { keepBranch: true });
    expect(henchmen.removed).toEqual([agentId]);
    expect(office.db.select().from(desks).where(eq(desks.agentId, agentId)).get()).toBeUndefined();
    const actions = office.db.select({ action: auditLog.action }).from(auditLog).all();
    expect(actions.map((a) => a.action)).toEqual(["agent.spawn", "agent.stop", "agent.send_home"]);
    await manager.close();
  }, 15_000);

  test("spawn without a prompt starts the henchman idle, titled after its issue", async () => {
    const adapter = fakeAdapter();
    const { manager, henchmen } = makeManager(office.db, runner, [adapter]);
    const { agentId } = await manager.spawn(
      office.member,
      spawnInput(office.operationId, office.repoId, { prompt: "", issueNumber: 42 }),
    );
    const henchman = await henchmen.waitFor(agentId, (r) => r.status === "idle");
    expect(henchman).toMatchObject({ taskTitle: "Issue #42", issueNumber: 42 });
    expect(adapter.lastControl?.prompts ?? []).toEqual([]);
    await manager.close();
  }, 15_000);

  test("an agent whose process exits on its own becomes exited", async () => {
    const { manager, henchmen } = makeManager(office.db, runner, [fakeAdapter()]);
    const { agentId } = await manager.spawn(
      office.owner,
      spawnInput(office.operationId, office.repoId),
    );
    await henchmen.waitFor(agentId, (r) => r.status === "working");
    await runner.sendKeys({ userId: office.owner.id, name: `agent-${agentId}` }, "exit", {
      enter: true,
    });
    await henchmen.waitFor(agentId, (r) => r.status === "exited");
    await manager.close();
  }, 15_000);

  test("spawn ACL, desks and profiles are enforced before anything runs", async () => {
    const adapter = fakeAdapter();
    const { manager } = makeManager(office.db, runner, [adapter]);
    const input = spawnInput(office.operationId, office.repoId);
    const code = (p: Promise<unknown>) =>
      p.then(
        () => "ok",
        (e: AgentManagerError) => e.code,
      );

    expect(await code(manager.spawn(office.viewer, input))).toBe("forbidden");
    expect(await code(manager.spawn(office.stranger, input))).toBe("forbidden");
    expect(await code(manager.spawn(office.member, { ...input, repoId: "nope" }))).toBe(
      "bad_request",
    );
    expect(await code(manager.spawn(office.member, { ...input, seatId: "seat-9" }))).toBe(
      "bad_request",
    );
    expect(await code(manager.spawn(office.member, { ...input, profileId: "someone-else" }))).toBe(
      "bad_request",
    );
    expect(await code(manager.spawn(office.member, { ...input, profileId: "office:custom" }))).toBe(
      "bad_request",
    );
    expect(await code(manager.spawn(office.member, { ...input, provider: "codex" }))).toBe(
      "bad_request",
    );
    expect(adapter.spawns).toHaveLength(0);
    expect(office.db.select().from(agents).all()).toHaveLength(0);

    const first = await manager.spawn(office.member, { ...input, seatId: "seat-1" });
    expect(await code(manager.spawn(office.owner, { ...input, seatId: "seat-1" }))).toBe(
      "conflict",
    );
    await manager.spawn(office.owner, input);
    await manager.spawn(office.owner, input);
    expect(await code(manager.spawn(office.owner, input))).toBe("conflict"); // all desks taken
    expect(first.seatId).toBe("seat-1");
    await manager.close();
  }, 15_000);

  test("a new manager re-adopts live sessions and marks dead ones offline", async () => {
    const first = makeManager(office.db, runner, [fakeAdapter()]);
    const alive = await first.manager.spawn(
      office.member,
      spawnInput(office.operationId, office.repoId),
    );
    const dead = await first.manager.spawn(
      office.member,
      spawnInput(office.operationId, office.repoId),
    );
    await first.henchmen.waitFor(alive.agentId, (r) => r.status === "working");
    await first.henchmen.waitFor(dead.agentId, (r) => r.status === "working");
    // The office goes away without stopping anything; one agent dies meanwhile.
    await first.manager.close();
    await runner.kill({ userId: office.member.id, agentId: dead.agentId });

    const adapter = fakeAdapter(false);
    const second = makeManager(office.db, runner, [adapter]);
    await second.manager.adopt();
    expect(second.henchmen.henchmen.get(dead.agentId)?.status).toBe("offline");
    const adopted = second.henchmen.henchmen.get(alive.agentId);
    expect(adopted?.status).toBe("working");
    expect(adopted?.seatId).toBe("seat-1");
    expect(adapter.controls).toHaveLength(1);
    expect(adapter.controls[0]?.plan.agentId).toBe(alive.agentId);
    expect(adapter.spawns).toHaveLength(0); // nothing was re-run
    // The re-attached channel is live: prompts reach it.
    await second.manager.prompt(office.member, alive.agentId, "again");
    expect(adapter.controls[0]?.prompts.map((p) => p.text)).toEqual(["again"]);

    // The offline one can be resumed on its provider session.
    await second.manager.resume(office.member, dead.agentId);
    expect(adapter.spawns.at(-1)?.resumeSessionId).toBe("sess-1");
    expect(second.henchmen.henchmen.get(dead.agentId)?.status).toBe("starting");
    expect(
      await runner.sessionExists({ userId: office.member.id, name: `agent-${dead.agentId}` }),
    ).toBe(true);
    await second.manager.close();
  }, 20_000);
});
