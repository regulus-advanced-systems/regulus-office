/**
 * Claude-shaped end to end: the manager spawns the Claude Code adapter with a
 * fake `claude` script in tmux; the script POSTs a SessionStart hook through
 * the real hook route with the token the manager issued; the manager's sink
 * turns it into a HenchmanState change (starting → idle). A wrong token is 401.
 * Skipped without tmux or curl.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ClaudeCodeAdapter } from "@regulus/agent-adapters";
import { eq } from "drizzle-orm";
import { agentEvents } from "../../db/schema/index.ts";
import { createOfficeServer, type OfficeServer } from "../../http/server.ts";
import { createLogger } from "../../logging.ts";
import { hasTmux, LocalTmuxRunner } from "../../runners/testing/local-tmux-runner.ts";
import { mountClaudeHookRoutes } from "../hooks/routes.ts";
import { makeManager, officeFixture, spawnInput } from "./test-helpers.ts";

const FAKE_CLAUDE = join(import.meta.dir, "../hooks/testing/fake-claude.sh");

describe.skipIf(!hasTmux() || !Bun.which("curl"))("Claude via hooks (tmux)", () => {
  let runner: LocalTmuxRunner;
  let server: OfficeServer;
  let office: Awaited<ReturnType<typeof officeFixture>>;
  let dist: string;

  beforeEach(async () => {
    runner = await LocalTmuxRunner.create();
    office = await officeFixture();
    dist = await mkdtemp(join(tmpdir(), "rgo-nodist-"));
    server = createOfficeServer({
      config: { port: 0, host: "127.0.0.1", webDist: join(dist, "missing") },
      logger: createLogger({ level: "silent" }),
      version: "test",
    });
  });

  afterEach(async () => {
    await server.stop(true);
    await runner.dispose();
    await rm(office.workdir, { recursive: true, force: true });
    await rm(dist, { recursive: true, force: true });
  });

  test("a hook posted with the issued token changes the henchman", async () => {
    const adapter = new ClaudeCodeAdapter({ command: FAKE_CLAUDE });
    const { manager, henchmen } = makeManager(office.db, runner, [adapter], {
      officeUrl: `http://127.0.0.1:${server.port}`,
    });
    mountClaudeHookRoutes(server.router, {
      sink: manager,
      tokens: manager.tokens,
      adapter,
      contextFor: (id) => manager.contextFor(id),
    });

    const { agentId } = await manager.spawn(
      office.member,
      spawnInput(office.operationId, office.repoId, { provider: "claude-code", model: "sonnet" }),
    );
    expect(henchmen.history[0]?.status).toBe("starting");
    const henchman = await henchmen.waitFor(agentId, (r) => r.status === "idle");
    expect(henchman.provider).toBe("claude-code");

    const kinds = office.db
      .select({ kind: agentEvents.kind })
      .from(agentEvents)
      .where(eq(agentEvents.agentId, agentId))
      .all()
      .map((e) => e.kind);
    expect(kinds).toContain("status");

    const denied = await fetch(
      `http://127.0.0.1:${server.port}/api/agents/${agentId}/hooks/claude`,
      {
        method: "POST",
        headers: { authorization: "Bearer not-the-token", "content-type": "application/json" },
        body: JSON.stringify({ hook_event_name: "Stop", session_id: "x" }),
      },
    );
    expect(denied.status).toBe(401);

    await manager.stop(office.member, agentId);
    expect(henchmen.henchmen.get(agentId)?.status).toBe("exited");
    await manager.close();
  }, 20_000);
});
