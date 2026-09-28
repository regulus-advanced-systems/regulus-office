/**
 * Integration: FakeAdapter plans a spawn, LocalTmuxRunner runs the fake agent
 * script in tmux on a private socket, and the runner reads, drives and kills
 * it. Skipped when tmux is not installed.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeAdapter, Secret, type SpawnPlan } from "@regulus/agent-adapters";
import { bindRunnerOps, type RunnerHandle } from "../types.ts";
import { hasTmux, LocalTmuxRunner, shellQuote } from "./local-tmux-runner.ts";

const FAKE_AGENT = join(import.meta.dir, "fake-agent.sh");
const KEY = "sk-integration-DO-NOT-LEAK";
const user = { userId: "u1" };

async function waitFor<T>(probe: () => Promise<T>, ok: (v: T) => boolean, ms = 5000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await probe();
    if (ok(value) || Date.now() > deadline) return value;
    await Bun.sleep(25);
  }
}

describe("shellQuote", () => {
  test("survives single quotes", async () => {
    const word = `it's "$HOME" \`x\``;
    const out = await Bun.$`sh -c ${`printf %s ${shellQuote(word)}`}`.text();
    expect(out).toBe(word);
  });
});

describe.skipIf(!hasTmux())("LocalTmuxRunner (tmux)", () => {
  let runner: LocalTmuxRunner;
  let handle: RunnerHandle;
  let workdir: string;

  beforeEach(async () => {
    runner = await LocalTmuxRunner.create();
    handle = await runner.provision(user);
    workdir = await mkdtemp(join(tmpdir(), "rgo-work-"));
  });

  afterEach(async () => {
    await runner.dispose();
    await rm(workdir, { recursive: true, force: true });
    expect(await Bun.file(runner.socket).exists()).toBe(false);
  });

  function plan(agentId: string): SpawnPlan {
    const adapter = new FakeAdapter({ command: ["sh", FAKE_AGENT] });
    const ctx = {
      backend: runner.backend,
      userId: user.userId,
      home: handle.home,
      officeUrl: "http://office.test",
      agentToken: Secret.of("hook-token"),
      now: Date.now,
      runner: bindRunnerOps(runner, user),
    };
    return adapter.buildSpawn(
      {
        agentId,
        provider: "custom",
        workdir,
        credential: { kind: "api_key", apiKey: Secret.of(KEY), attributedTo: "user" },
      },
      ctx,
    );
  }

  test("starts the fake agent, captures its pane, drives it and kills it", async () => {
    const p = plan("a1");
    const session = await runner.exec(user, p);
    expect(session).toEqual({ userId: "u1", name: "agent-a1" });
    expect(await runner.sessionExists(session)).toBe(true);
    expect(await runner.listSessions(user)).toEqual(["agent-a1"]);

    const screen = await waitFor(
      () => runner.capturePane(session, 50),
      (s) => s.includes("FAKE AGENT READY"),
    );
    expect(screen).toContain("FAKE AGENT key=present");
    expect(screen).not.toContain(KEY);
    expect(await runner.paneTitle(session)).toBe("fake-agent: idle");

    // The env file was sourced and removed; the hook file was written 0600.
    const leftovers = (await runner.listDir(user, runner.dir)).filter((f) => f.startsWith("env-"));
    expect(leftovers).toEqual([]);
    const hookFile = p.files[0]?.path ?? "";
    expect((await stat(hookFile)).mode & 0o777).toBe(0o600);

    const ops = bindRunnerOps(runner, user);
    await ops.sendKeys("agent-a1", "hello tmux", { enter: true });
    expect(
      await waitFor(
        () => ops.capturePane("agent-a1", 50),
        (s) => s.includes("you said: hello tmux"),
      ),
    ).toContain("you said: hello tmux");

    const procs = await runner.listProcesses({ userId: "u1", agentId: "a1" });
    expect(procs.some((proc) => proc.command === "sh")).toBe(true);
    expect(await runner.listPorts({ userId: "u1", agentId: "a1" })).toEqual([]);

    const watch = runner.attach(session, "watch");
    expect(watch.kind).toBe("argv");
    expect(watch.argv).toContain("-r");
    expect(runner.attach(session, "control").argv).not.toContain("-r");

    await runner.kill({ userId: "u1", agentId: "a1" });
    expect(await runner.sessionExists(session)).toBe(false);
    await runner.kill({ userId: "u1", agentId: "a1" });
  });

  test("session lookups are exact, not prefix matches", async () => {
    await runner.exec(user, plan("a10"));
    expect(await runner.sessionExists({ userId: "u1", name: "agent-a1" })).toBe(false);
  });

  test("spawnPiped runs a stdio process with the plan env", async () => {
    const p = {
      ...plan("a2"),
      argv: ["sh", "-c", 'read line; echo "got $line"; test -n "$FAKE_API_KEY"'],
    };
    const proc = await runner.spawnPiped(user, p);
    await proc.write("ping\n");
    expect(await new Response(proc.stdout).text()).toBe("got ping\n");
    expect(await proc.exited).toBe(0);
  });
});
