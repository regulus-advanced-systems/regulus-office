/**
 * A henchman whose owner loses the room (owner decision of 2026-10-07 on
 * #270; SPEC D12, D27): the running task finishes, the henchman takes
 * nothing new from that person, and the owner cannot reach it any more.
 * Over LocalTmuxRunner with the FakeAdapter; skipped without tmux.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { FakeAdapter } from "@regulus/agent-adapters";
import { seedRoomMember } from "../../github/access/test-snapshot.ts";
import { hasTmux, LocalTmuxRunner } from "../../runners/testing/local-tmux-runner.ts";
import { AgentManagerError } from "./errors.ts";
import { FAKE_AGENT, makeManager, officeFixture, spawnInput } from "./test-helpers.ts";

type Office = Awaited<ReturnType<typeof officeFixture>>;

const adapter = () =>
  new FakeAdapter({
    command: ["sh", FAKE_AGENT],
    providerSessionId: "sess-1",
    script: [{ kind: "status", ts: 1, status: "idle" }],
    onPrompt: (_text, ts) => [{ kind: "status", ts, status: "working" }],
  });

async function refusal(run: () => Promise<unknown>): Promise<AgentManagerError> {
  try {
    await run();
  } catch (err) {
    if (err instanceof AgentManagerError) return err;
    throw err;
  }
  throw new Error("expected a refusal");
}

describe.skipIf(!hasTmux())("a henchman whose owner loses the room", () => {
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

  test("no access at all: the task keeps running, and to its owner the henchman is gone", async () => {
    const fake = adapter();
    const { manager, henchmen } = makeManager(office.db, runner, [fake]);
    const { operationId, repoId, member } = office;
    const { agentId } = await manager.spawn(member, spawnInput(operationId, repoId));
    await henchmen.waitFor(agentId, (h) => h.status === "working");

    // GitHub no longer shows Mia the repo.
    seedRoomMember(office.db, member.id, operationId, null);

    // The running task is not touched: same status, same process.
    expect(manager.view(agentId)?.status).toBe("working");
    expect((await runner.listSessions({ userId: member.id })).length).toBe(1);

    // Nothing new, and nothing that would show her the room: every control is "no such agent".
    const prompts = fake.lastControl?.prompts.length;
    for (const attempt of [
      () => manager.prompt(member, agentId, "one more thing"),
      () => manager.interrupt(member, agentId),
      () => manager.respondPermission(member, agentId, "r1", "allow_once"),
      () => manager.resume(member, agentId),
      () => manager.openPullRequest(member, agentId, { draft: false }),
      () => manager.worktreeStatus(member, agentId),
      () => manager.stop(member, agentId),
      () => manager.sendHome(member, agentId, { keepBranch: true }),
    ]) {
      const err = await refusal(attempt);
      expect(err.code).toBe("not_found");
      expect(err.message).toBe("no such agent");
    }
    expect(fake.lastControl?.prompts.length).toBe(prompts);
    // No new henchman either.
    expect((await refusal(() => manager.spawn(member, spawnInput(operationId, repoId)))).code).toBe(
      "forbidden",
    );
    expect(manager.view(agentId)?.status).toBe("working");

    // An office admin can still emergency-stop it as an action, by person, without the room.
    seedRoomMember(office.db, office.admin.id, operationId, null);
    expect((await refusal(() => manager.emergencyStopAllOf(member, member.id))).code).toBe(
      "forbidden",
    );
    expect(await manager.emergencyStopAllOf(office.admin, office.stranger.id)).toBe(0);
    expect(await manager.emergencyStopAllOf(office.admin, member.id)).toBe(1);
    await henchmen.waitFor(agentId, (h) => h.status === "exited");
  });

  test("lowered to view: no new work, but she can still stop it and send it home", async () => {
    const fake = adapter();
    const { manager, henchmen } = makeManager(office.db, runner, [fake]);
    const { operationId, repoId, member } = office;
    const { agentId } = await manager.spawn(member, spawnInput(operationId, repoId));
    await henchmen.waitFor(agentId, (h) => h.status === "working");

    seedRoomMember(office.db, member.id, operationId, "view");
    const prompts = fake.lastControl?.prompts.length;
    for (const attempt of [
      () => manager.prompt(member, agentId, "one more thing"),
      () => manager.interrupt(member, agentId),
      () => manager.respondPermission(member, agentId, "r1", "allow_once"),
      () => manager.resume(member, agentId),
      () => manager.openPullRequest(member, agentId, { draft: false }),
    ]) {
      const err = await refusal(attempt);
      expect(err.code).toBe("forbidden");
      expect(err.message).toContain("you can no longer work in this room");
    }
    expect(fake.lastControl?.prompts.length).toBe(prompts);
    expect(manager.view(agentId)?.status).toBe("working");

    await manager.stop(member, agentId);
    await henchmen.waitFor(agentId, (h) => h.status === "exited");
    await manager.sendHome(member, agentId, { keepBranch: true });
    expect(manager.view(agentId)).toBeUndefined();

    // With the permission back she works there again.
    seedRoomMember(office.db, member.id, operationId, "spawn");
    const again = await manager.spawn(member, spawnInput(operationId, repoId));
    await manager.prompt(member, again.agentId, "carry on");
  });
});
