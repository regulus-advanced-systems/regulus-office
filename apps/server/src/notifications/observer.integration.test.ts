/**
 * The AgentManager → notifications seam (#42): a real manager over
 * LocalTmuxRunner with the FakeAdapter reports status changes with the
 * previous status, and the tab-badge query sees the persisted status.
 * Skipped without tmux.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { FakeAdapter } from "@regulus/agent-adapters";
import type { AgentStatus } from "@regulus/protocol";
import {
  FAKE_AGENT,
  makeManager,
  officeFixture,
  spawnInput,
} from "../agents/manager/test-helpers.ts";
import { hasTmux, LocalTmuxRunner } from "../runners/testing/local-tmux-runner.ts";
import { NotificationDirectory } from "./directory.ts";

describe.skipIf(!hasTmux())("AgentManager observer (tmux)", () => {
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

  test("status changes reach the observer after they are persisted", async () => {
    const directory = new NotificationDirectory(office.db);
    const seen: { status: AgentStatus; previous: AgentStatus; badge: string[] }[] = [];
    const adapter = new FakeAdapter({
      command: ["sh", FAKE_AGENT],
      script: [{ kind: "status", ts: 1, status: "idle" }],
      onPrompt: (_text, ts) => [{ kind: "status", ts, status: "waiting_input" }],
    });
    const { manager, robots } = makeManager(office.db, runner, [adapter], {
      observer: {
        statusChanged: (view, previous) =>
          seen.push({
            status: view.status,
            previous,
            badge: directory.attention(view.ownerUserId),
          }),
        pullRequestOpened: () => {},
      },
    });
    const { agentId } = await manager.spawn(
      office.member,
      spawnInput(office.floorId, office.repoId, { taskTitle: "Fix it" }),
    );
    await robots.waitFor(agentId, (r) => r.status === "waiting_input");
    const asked = seen.find((s) => s.status === "waiting_input");
    expect(asked?.badge).toEqual([agentId]);
    expect(seen[0]?.previous).toBe("starting");
    await manager.stop(office.member, agentId);
    expect(seen.at(-1)).toMatchObject({ status: "exited", badge: [] });
    await manager.close();
  });
});
