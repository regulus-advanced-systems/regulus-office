/**
 * Per-robot permission mode (#166) through the manager: validated per
 * provider at spawn, stored on the row, published in RobotState, handed to the
 * adapter, and kept on resume. Uses the FakeAdapter under provider ids that
 * have modes. Skipped without tmux.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { FakeAdapter } from "@regulus/agent-adapters";
import { eq } from "drizzle-orm";
import { agents } from "../../db/schema/index.ts";
import { hasTmux, LocalTmuxRunner } from "../../runners/testing/local-tmux-runner.ts";
import type { AgentManagerError } from "./errors.ts";
import { FAKE_AGENT, makeManager, officeFixture, spawnInput } from "./test-helpers.ts";

const fake = (id: "claude-code" | "codex") =>
  new FakeAdapter({
    id,
    command: ["sh", FAKE_AGENT],
    providerSessionId: "sess-1",
    script: [{ kind: "status", ts: 1, status: "idle" }],
  });

describe.skipIf(!hasTmux())("permission mode (tmux)", () => {
  let runner: LocalTmuxRunner;
  let office: Awaited<ReturnType<typeof officeFixture>>;

  beforeEach(async () => {
    runner = await LocalTmuxRunner.create();
    office = await officeFixture();
  });

  afterEach(async () => {
    await runner.dispose();
    await rm(office.workdir, { recursive: true, force: true });
  });

  test("the chosen mode is stored, shown and passed again on resume", async () => {
    const adapter = fake("claude-code");
    const { manager, robots } = makeManager(office.db, runner, [adapter]);
    const { agentId } = await manager.spawn(
      office.member,
      spawnInput(office.floorId, office.repoId, {
        provider: "claude-code",
        prompt: "",
        permissionMode: "acceptEdits",
      }),
    );
    const robot = await robots.waitFor(agentId, (r) => r.status === "idle");
    expect(robot.permissionMode).toBe("acceptEdits");
    expect(adapter.spawns[0]?.permissionMode).toBe("acceptEdits");
    const row = office.db.select().from(agents).where(eq(agents.id, agentId)).get();
    expect(row?.permissionMode).toBe("acceptEdits");

    await manager.stop(office.member, agentId);
    await manager.resume(office.member, agentId);
    expect(adapter.spawns.at(-1)).toMatchObject({
      resumeSessionId: "sess-1",
      permissionMode: "acceptEdits",
    });
    await manager.close();
  }, 15_000);

  test("no mode = the provider default; a mode of another provider is refused", async () => {
    const claude = fake("claude-code");
    const codex = fake("codex");
    const { manager, robots } = makeManager(office.db, runner, [claude, codex]);
    const input = spawnInput(office.floorId, office.repoId, { prompt: "" });
    const code = (p: Promise<unknown>) =>
      p.then(
        () => "ok",
        (e: AgentManagerError) => e.code,
      );

    expect(
      await code(
        manager.spawn(office.member, {
          ...input,
          provider: "claude-code",
          permissionMode: "never",
        }),
      ),
    ).toBe("bad_request");
    expect(
      await code(
        manager.spawn(office.member, { ...input, provider: "codex", permissionMode: "auto" }),
      ),
    ).toBe("bad_request");
    expect(claude.spawns.length + codex.spawns.length).toBe(0);

    const a = await manager.spawn(office.member, { ...input, provider: "claude-code" });
    const b = await manager.spawn(office.member, { ...input, provider: "codex" });
    expect((await robots.waitFor(a.agentId, (r) => r.status === "idle")).permissionMode).toBe(
      "auto",
    );
    expect((await robots.waitFor(b.agentId, (r) => r.status === "idle")).permissionMode).toBe(
      "on-request",
    );
    expect(claude.spawns[0]?.permissionMode).toBe("auto");
    expect(codex.spawns[0]?.permissionMode).toBe("on-request");
    await manager.close();
  }, 15_000);
});
