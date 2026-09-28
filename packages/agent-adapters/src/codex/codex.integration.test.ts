/**
 * Integration: CodexAdapter drives a fake `codex app-server` (a Bun script
 * replaying a documented trace over real stdio) started through
 * LocalTmuxRunner.spawnPiped, the test double of the server's runners.
 *
 * The runner is imported from apps/server by path because it is test-only
 * code there; @regulus/agent-adapters itself never depends on the server.
 */
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentEvent } from "@regulus/protocol";
import {
  hasTmux,
  LocalTmuxRunner,
} from "../../../../apps/server/src/runners/testing/local-tmux-runner.ts";
import { bindRunnerOps } from "../../../../apps/server/src/runners/types.ts";
import { Secret } from "../secret.ts";
import type { RunnerContext } from "../types.ts";
import { CodexAdapter } from "./adapter.ts";
import type { CodexControl } from "./control.ts";
import { CWD, toJsonl, turnWithApprovals } from "./fixtures/documented.ts";

const FAKE_SERVER = join(import.meta.dir, "testing", "fake-app-server-main.ts");
const user = { userId: "u1" };
let runner: LocalTmuxRunner;
let dir: string;

beforeEach(async () => {
  runner = await LocalTmuxRunner.create();
  dir = await mkdtemp(join(tmpdir(), "rgo-codex-"));
});

afterEach(async () => {
  await runner.dispose();
  await rm(dir, { recursive: true, force: true });
});

test.skipIf(!hasTmux())(
  "full turn with approvals over stdio through LocalTmuxRunner.spawnPiped",
  async () => {
    const handle = await runner.provision(user);
    const tracePath = join(dir, "trace.jsonl");
    await Bun.write(tracePath, toJsonl(turnWithApprovals).replaceAll(CWD, dir));
    const ctx: RunnerContext = {
      backend: runner.backend,
      userId: user.userId,
      home: handle.home,
      officeUrl: "http://office.test",
      runner: bindRunnerOps(runner, user),
      now: Date.now,
    };
    const adapter = new CodexAdapter({ command: [process.execPath, FAKE_SERVER, tracePath] });
    const plan = adapter.buildSpawn(
      {
        agentId: "a1",
        provider: "codex",
        workdir: dir,
        credential: { kind: "api_key", apiKey: Secret.of("sk-int-test"), attributedTo: "user" },
      },
      ctx,
    );
    const control = adapter.connect(plan, ctx) as CodexControl;
    const events: AgentEvent[] = [];
    const pump = (async () => {
      for await (const e of control.events) {
        events.push(e);
        if (e.kind === "permission_request") {
          void control.respondPermission(
            e.requestId,
            e.toolName === "shell" ? "allow_once" : "allow_always",
          );
        }
      }
    })();
    await control.ready();
    const waitFor = async (check: () => boolean) => {
      const deadline = Date.now() + 5000;
      while (!check() && Date.now() < deadline) await Bun.sleep(10);
      expect(check()).toBe(true);
    };
    await waitFor(() => events.some((e) => e.kind === "limit"));
    await control.prompt("Run the tests and fix app.ts");
    await waitFor(() => events.some((e) => e.kind === "message" && !e.partial));
    await waitFor(
      () => events.filter((e) => e.kind === "status" && e.status === "idle").length >= 2,
    );
    await control.close();
    await pump;

    expect(events.filter((e) => e.kind === "permission_request")).toHaveLength(2);
    expect(events.find((e) => e.kind === "message" && !e.partial)).toMatchObject({
      text: "Tests pass.",
    });
    expect(events.filter((e) => e.kind === "usage")).toHaveLength(1);
    // SIGTERM → the fake exits 0 (a mismatch would have exited 3).
    expect(events.at(-1)).toMatchObject({ kind: "exit", code: 0 });
  },
);
