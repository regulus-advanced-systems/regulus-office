/**
 * Integration: the Claude adapter plans a spawn whose `claude` is a fake
 * script; LocalTmuxRunner runs it in tmux; it runs the generated command hook
 * and statusline forwarders against a real office server on port 0; the
 * events land in a MemoryEventSink. The fake refuses http hooks to private
 * addresses like Claude Code does, so the office is also served on a private
 * interface address when the host has one (#162: Compose runners reach the
 * office at `office` → 172.x). Skipped without tmux or curl.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { networkInterfaces, tmpdir } from "node:os";
import { join } from "node:path";
import { ClaudeCodeAdapter, Secret } from "@regulus/agent-adapters";
import { createOfficeServer, type OfficeServer } from "../../http/server.ts";
import { createLogger } from "../../logging.ts";
import { hasTmux, LocalTmuxRunner } from "../../runners/testing/local-tmux-runner.ts";
import { bindRunnerOps } from "../../runners/types.ts";
import { MemoryEventSink } from "../events.ts";
import { mountClaudeHookRoutes } from "./routes.ts";
import { MemoryAgentTokens } from "./tokens.ts";

const FAKE_CLAUDE = join(import.meta.dir, "testing", "fake-claude.sh");
const user = { userId: "u1" };

/** A non-loopback private IPv4 of this host (Claude Code refuses http hooks to these). */
function privateAddress(): string | undefined {
  const all = Object.values(networkInterfaces()).flatMap((list) => list ?? []);
  return all.find(
    (a) =>
      a.family === "IPv4" &&
      !a.internal &&
      /^(10|172\.(1[6-9]|2\d|3[01])|192\.168)\./.test(a.address),
  )?.address;
}

describe.skipIf(!hasTmux() || !Bun.which("curl"))("claude hooks end to end (tmux)", () => {
  let runner: LocalTmuxRunner;
  let server: OfficeServer;
  let workdir: string;
  let missingDist: string;
  const logLines: string[] = [];

  beforeEach(async () => {
    runner = await LocalTmuxRunner.create();
    workdir = await mkdtemp(join(tmpdir(), "rgo-claude-work-"));
    missingDist = join(workdir, "no-dist");
    server = createOfficeServer({
      config: { port: 0, host: "127.0.0.1", webDist: missingDist },
      logger: createLogger({
        level: "debug",
        destination: { write: (l: string) => logLines.push(l) },
      }),
      version: "test",
    });
  });

  afterEach(async () => {
    await server.stop(true);
    await runner.dispose();
    await rm(workdir, { recursive: true, force: true });
  });

  const hosts = ["127.0.0.1", privateAddress()].filter((h): h is string => Boolean(h));
  test.each(hosts)(
    "a hook and a statusline from the runner reach the sink (office on %s)",
    async (host) => {
      if (host !== "127.0.0.1") {
        await server.stop(true);
        server = createOfficeServer({
          config: { port: 0, host, webDist: missingDist },
          logger: createLogger({
            level: "debug",
            destination: { write: (l: string) => logLines.push(l) },
          }),
          version: "test",
        });
      }
      const sink = new MemoryEventSink();
      const tokens = new MemoryAgentTokens();
      const adapter = new ClaudeCodeAdapter({ command: FAKE_CLAUDE });
      mountClaudeHookRoutes(server.router, { sink, tokens, adapter });
      const token = tokens.issue("a1");
      const handle = await runner.provision(user);
      const ctx = {
        backend: runner.backend,
        userId: user.userId,
        home: handle.home,
        officeUrl: `http://${host}:${server.port}`,
        agentToken: Secret.of(token),
        runner: bindRunnerOps(runner, user),
        now: Date.now,
      };
      const plan = adapter.buildSpawn(
        { agentId: "a1", provider: "claude-code", workdir, credential: { kind: "cli_login" } },
        ctx,
      );
      const started = sink.next((e) => e.kind === "status" && e.status === "idle", "a1");
      const limit = sink.next((e) => e.kind === "limit", "a1");
      await runner.exec(user, plan);

      expect(await started).toMatchObject({ kind: "status", status: "idle" });
      expect(await limit).toMatchObject({ windowKind: "five_hour", usedPct: 12 });
      expect(sink.for("a1").some((e) => e.kind === "usage")).toBe(true);
      expect(adapter.connect(plan, ctx).providerSessionId()).toBe(plan.providerSessionId as string);

      let pane = "";
      for (let i = 0; i < 100 && !pane.includes("FAKE CLAUDE DONE"); i++) {
        pane = await runner.capturePane({ userId: user.userId, name: plan.tmuxSession }, 50);
        await Bun.sleep(20);
      }
      expect(pane).toContain("FAKE CLAUDE hook SessionStart (command) -> exit 0");
      expect(pane).not.toContain("hook error");
      expect(pane).toContain("Regulus Office | Fake");
      expect(pane).not.toContain(token);

      const logs = logLines.join("\n");
      expect(logs).toContain("/api/agents/:agentId/hooks/claude");
      expect(logs).toContain("/api/agents/:agentId/statusline");
      expect(logs).not.toContain(token);
    },
    15_000,
  );
});
