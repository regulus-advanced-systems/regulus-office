/**
 * Integration: DockerRunner against a real Docker daemon. Builds a tiny image
 * from fixtures/Dockerfile (debian-slim + tmux + the fake agent, not the full
 * runner image), provisions a runner, mounts a floor, runs the fake agent in
 * tmux and drives, inspects and kills it.
 *
 * Opt-in: runs when REGULUS_DOCKER_TESTS=1 (and then requires the daemon) (CI job
 * `docker-runner`, which also routes the runner through the socket proxy);
 * skipped otherwise. Everything it creates is labelled
 * `regulus-test=1` and removed in afterAll.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeAdapter, Secret, type SpawnPlan } from "@regulus/agent-adapters";
import { bindRunnerOps, type RunnerHandle } from "../types.ts";
import { DockerRunner } from "./docker-runner.ts";
import { EngineClient } from "./engine.ts";
import { tar } from "./testing/tar.ts";

/** Build and cleanup use the local daemon (image build is outside the proxy allowlist). */
const engine = new EngineClient();
/**
 * The runner itself can go through a docker-socket-proxy with the deploy/
 * allowlist (#95), as in Compose: REGULUS_DOCKER_RUNNER_HOST=tcp://127.0.0.1:2375.
 */
const runnerEngine = new EngineClient(process.env.REGULUS_DOCKER_RUNNER_HOST ?? undefined);
const requested = process.env.REGULUS_DOCKER_TESTS === "1";
const reachable = requested && (await engine.ping());
// Asked for but no daemon: fail loudly rather than skip, so CI cannot pass vacuously.
if (requested && !reachable) throw new Error("REGULUS_DOCKER_TESTS=1 but Docker is not reachable");
const enabled = requested && reachable;
const TEST_LABEL = { "regulus-test": "1" };
const suffix = Math.random().toString(36).slice(2, 8);
const IMAGE = `regulus-test-runner:${suffix}`;
const KEY = "sk-docker-integration-DO-NOT-LEAK";
const user = { userId: "u1" };

async function waitFor<T>(probe: () => Promise<T>, ok: (v: T) => boolean, ms = 10_000) {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await probe();
    if (ok(value) || Date.now() > deadline) return value;
    await Bun.sleep(100);
  }
}

async function buildImage(): Promise<void> {
  const dir = join(import.meta.dir, "fixtures");
  const context = tar([
    { name: "Dockerfile", data: await Bun.file(join(dir, "Dockerfile")).text(), mode: 0o644 },
    {
      name: "fake-agent.sh",
      data: await Bun.file(join(import.meta.dir, "../testing/fake-agent.sh")).text(),
      mode: 0o755,
    },
  ]);
  const res = await engine.request("POST", "/build", {
    query: { t: IMAGE, rm: true, forcerm: true, labels: JSON.stringify(TEST_LABEL) },
    body: context,
    contentType: "application/x-tar",
  });
  const log = await res.text();
  if (!res.ok || log.includes('"errorDetail"')) throw new Error(`image build failed:\n${log}`);
}

async function cleanup(): Promise<void> {
  const filters = JSON.stringify({ label: ["regulus-test=1"] });
  const containers = await engine.json<{ Id: string }[]>("GET", "/containers/json", {
    query: { all: true, filters },
  });
  for (const c of containers) {
    await engine.call("DELETE", `/containers/${c.Id}`, { query: { force: true } });
  }
  const { Volumes } = await engine.json<{ Volumes: { Name: string }[] | null }>("GET", "/volumes", {
    query: { filters },
  });
  for (const v of Volumes ?? []) await engine.call("DELETE", `/volumes/${v.Name}`);
  await engine.request("DELETE", `/images/${IMAGE}`, { query: { force: true } });
}

describe.skipIf(!enabled)("DockerRunner (real Docker)", () => {
  let runner: DockerRunner;
  let handle: RunnerHandle;
  let root: string;
  let workdir: string;

  beforeAll(async () => {
    await buildImage();
    root = await mkdtemp(join(tmpdir(), "rgo-docker-"));
    workdir = join(root, "projects", "f1", "repo");
    await mkdir(workdir, { recursive: true });
    for (const d of [root, join(root, "projects"), join(root, "projects", "f1"), workdir]) {
      await chmod(d, 0o755);
    }
    runner = new DockerRunner({
      engine: runnerEngine,
      image: IMAGE,
      prefix: `rgtest-${suffix}`,
      user: "1001:1001",
      home: "/home/runner",
      labels: TEST_LABEL,
      pull: false,
      pidsLimit: 256,
      floorRoots: [join(root, "projects"), join(root, "worktrees")],
    });
    handle = await runner.provision(user);
  }, 600_000);

  afterAll(async () => {
    await cleanup();
    if (root) await rm(root, { recursive: true, force: true });
  }, 120_000);

  function plan(agentId: string): SpawnPlan {
    const adapter = new FakeAdapter({ command: ["fake-agent"] });
    return adapter.buildSpawn(
      {
        agentId,
        provider: "custom",
        workdir,
        credential: { kind: "api_key", apiKey: Secret.of(KEY), attributedTo: "user" },
      },
      {
        backend: runner.backend,
        userId: user.userId,
        home: handle.home,
        officeUrl: "http://office.test",
        agentToken: Secret.of("hook-token"),
        now: Date.now,
        runner: bindRunnerOps(runner, user),
      },
    );
  }

  test("mounts the floor, runs the fake agent, drives, inspects and kills it", async () => {
    expect(await runner.mountProject(user, { floorId: "f1", repoId: "r1", workdir })).toEqual({
      workdir,
    });
    const p = plan("a1");
    const session = await runner.exec(user, p);
    const screen = await waitFor(
      () => runner.capturePane(session, 50),
      (s) => s.includes("FAKE AGENT READY"),
    );
    expect(screen).toContain("FAKE AGENT key=present");
    expect(screen).not.toContain(KEY);
    expect(await runner.paneTitle(session)).toBe("fake-agent: idle");
    expect(await runner.listSessions(user)).toEqual(["agent-a1"]);

    // The key is in neither the container config nor a leftover env file.
    const { containerId } = await runner.provision(user);
    const inspect = await engine.json("GET", `/containers/${containerId}/json`);
    expect(JSON.stringify(inspect)).not.toContain(KEY);
    expect(JSON.stringify(inspect)).toContain("IS_SANDBOX=1");
    const run = await runner.listDir(user, "/home/runner/.office/run");
    expect(run.filter((f) => f.startsWith("env-"))).toEqual([]);
    const hook = p.files[0]?.path ?? "";
    expect(await runner.readTextFile(user, hook)).toContain("hook-token");
    const stat = await engine.exec(containerId ?? "", { cmd: ["stat", "-c", "%a %u", hook] });
    expect(stat.stdout.trim()).toBe("600 1001");
    const id = await engine.exec(containerId ?? "", { cmd: ["id", "-u"] });
    expect(id.stdout.trim()).toBe("1001");
    const pwd = await engine.exec(containerId ?? "", { cmd: ["ls", "-d", workdir] });
    expect(pwd.code).toBe(0);

    await runner.sendKeys(session, "hello docker", { enter: true });
    const echoed = await waitFor(
      () => runner.capturePane(session, 50),
      (s) => s.includes("you said: hello docker"),
    );
    expect(echoed).toContain("you said: hello docker");

    const procs = await runner.listProcesses({ userId: "u1", agentId: "a1" });
    expect(procs.length).toBeGreaterThan(0);
    expect(await runner.listPorts({ userId: "u1", agentId: "a1" })).toEqual([]);

    // Terminal bridge path: a read-only TTY attach sees the pane.
    const target = runner.attach(session, "watch");
    const tty = await target.open({ cols: 120, rows: 40 });
    const reader = tty.output.getReader();
    let seen = "";
    const deadline = Date.now() + 10_000;
    while (!seen.includes("you said") && Date.now() < deadline) {
      const { value, done } = await reader.read();
      if (done) break;
      seen += new TextDecoder().decode(value);
    }
    expect(seen).toContain("you said: hello docker");
    await tty.resize({ cols: 100, rows: 30 });
    tty.close();
    await tty.closed;
    expect(await runner.sessionExists(session)).toBe(true);

    await runner.kill({ userId: "u1", agentId: "a1" });
    expect(await runner.sessionExists(session)).toBe(false);
    expect(await runner.listProcesses({ userId: "u1", agentId: "a1" })).toEqual([]);
    await runner.kill({ userId: "u1", agentId: "a1" });
  }, 60_000);

  test("spawnPiped runs a stdio process with the plan env", async () => {
    const p = {
      ...plan("a2"),
      argv: ["sh", "-c", 'read line; echo "got $line"; test -n "$FAKE_API_KEY"'],
    };
    const proc = await runner.spawnPiped(user, p);
    expect(proc.pid).toBeGreaterThan(1);
    await proc.write("ping\n");
    expect(await new Response(proc.stdout).text()).toBe("got ping\n");
    expect(await proc.exited).toBe(0);
  }, 30_000);

  test("recover finds the runner again", async () => {
    const fresh = new DockerRunner({
      engine: runnerEngine,
      image: IMAGE,
      prefix: `rgtest-${suffix}`,
      user: "1001:1001",
      home: "/home/runner",
    });
    const handles = await fresh.recover();
    // mountProject recreated the container, so compare with the current one.
    const current = await runner.provision(user);
    expect(handles.map((h) => h.containerId)).toEqual([current.containerId]);
  }, 30_000);
});
