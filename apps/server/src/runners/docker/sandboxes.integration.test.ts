/**
 * Integration: per-agent sandboxes (#169) of the DockerRunner against a real
 * Docker daemon, with the tiny fixture image (tmux + busybox). Two robots of
 * one human each run a web server on port 3000 in their own sandbox, and the
 * human's runner reaches both by sandbox name over a user-defined network, as
 * the office does over the runners network. Also: limits, isolation (no view
 * of another sandbox's processes or another human's area), non-root without
 * the socket, umask 0002, re-adoption by a fresh runner, and that stop
 * removes the sandbox.
 *
 * Opt-in like docker-runner.integration.test.ts: REGULUS_DOCKER_TESTS=1 (CI
 * job `docker-runner`, runner calls through the socket proxy). Everything it
 * creates is labelled `regulus-test=1` and removed in afterAll.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SecretEnv, type SpawnPlan } from "@regulus/agent-adapters";
import { DEFAULT_SANDBOX_SETTINGS, type SandboxSettings } from "../sandbox.ts";
import type { SandboxInfo } from "../types.ts";
import { DockerRunner } from "./docker-runner.ts";
import { DockerApiError, EngineClient } from "./engine.ts";
import { tar } from "./testing/tar.ts";

const engine = new EngineClient();
const runnerEngine = new EngineClient(process.env.REGULUS_DOCKER_RUNNER_HOST ?? undefined);
const requested = process.env.REGULUS_DOCKER_TESTS === "1";
const reachable = requested && (await engine.ping());
if (requested && !reachable) throw new Error("REGULUS_DOCKER_TESTS=1 but Docker is not reachable");
const enabled = requested && reachable;
const TEST_LABEL = { "regulus-test": "1" };
const suffix = Math.random().toString(36).slice(2, 8);
const IMAGE = `regulus-test-runner:sbx-${suffix}`;
const NETWORK = `rgtest-sbx-${suffix}`;
const PREFIX = `rgsbx-${suffix}`;
const KEY = "sk-sandbox-integration-DO-NOT-LEAK";
const user = { userId: "u1" };
const settings: SandboxSettings = {
  ...DEFAULT_SANDBOX_SETTINGS,
  memoryBytes: 256 * 1024 ** 2,
  cpus: 1.5,
  pids: 128,
};

async function waitFor<T>(probe: () => Promise<T>, ok: (v: T) => boolean, ms = 15_000) {
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
  const filters = JSON.stringify({ label: [`org.regulus.office.prefix=${PREFIX}`] });
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
  await engine.request("DELETE", `/networks/${NETWORK}`);
  await engine.request("DELETE", `/images/${IMAGE}`, { query: { force: true } });
}

interface Inspect {
  Id: string;
  Config: { User: string; Env: string[] };
  State: { Running: boolean };
  HostConfig: {
    Memory: number;
    NanoCpus: number;
    PidsLimit: number;
    Privileged: boolean;
    Mounts: { Source?: string; Target: string }[];
  };
}

describe.skipIf(!enabled)("DockerRunner sandboxes (real Docker, #169)", () => {
  let runner: DockerRunner;
  let root: string;
  const area = (rid: string) => join(root, "worktrees", "f1", rid);
  const workdir = (rid: string, agentId: string) => join(area(rid), agentId);
  const infos = new Map<string, SandboxInfo | null>();

  const sandboxName = (agentId: string) => `${PREFIX}-sbx-${agentId}`;
  const inspect = (agentId: string) =>
    engine.json<Inspect>("GET", `/containers/${sandboxName(agentId)}/json`);
  const inSandbox = async (agentId: string, cmd: string[]) =>
    engine.exec((await inspect(agentId)).Id, { cmd });

  function serverPlan(agentId: string): SpawnPlan {
    // A dev server that ignores $PORT and insists on 3000, as many do.
    const script = [
      "mkdir -p /tmp/www",
      `echo "robot ${agentId} PORT=$PORT" > /tmp/www/index.html`,
      "touch $HOME/made-by-" + agentId,
      "exec busybox httpd -f -p 3000 -h /tmp/www",
    ].join(" && ");
    return {
      agentId,
      provider: "custom",
      argv: ["sh", "-c", script],
      env: SecretEnv.of({ FAKE_API_KEY: KEY }),
      cwd: workdir("u1", agentId),
      tmuxSession: `agent-${agentId}`,
      files: [],
    };
  }

  beforeAll(async () => {
    await buildImage();
    // A user-defined network, like Compose's runners network (container names resolve).
    await engine.call("POST", "/networks/create", {
      json: { Name: NETWORK, Labels: { ...TEST_LABEL } },
    });
    root = await mkdtemp(join(tmpdir(), "rgo-sbx-"));
    for (const [rid, agent] of [
      ["u1", "a1"],
      ["u1", "a2"],
      ["u2", "b1"],
    ] as const) {
      await mkdir(workdir(rid, agent), { recursive: true });
    }
    for (const d of [root, join(root, "worktrees"), join(root, "worktrees", "f1")]) {
      await chmod(d, 0o755);
    }
    for (const rid of ["u1", "u2"]) await chmod(area(rid), 0o777);
    runner = new DockerRunner({
      engine: runnerEngine,
      image: IMAGE,
      prefix: PREFIX,
      user: "1001:1001",
      home: "/home/runner",
      labels: TEST_LABEL,
      pull: false,
      network: NETWORK,
      floorRoots: [join(root, "worktrees")],
      sandboxes: settings,
    });
    for (const agentId of ["a1", "a2"]) {
      infos.set(
        agentId,
        await runner.sandbox({ userId: "u1", agentId }, { workdir: workdir("u1", agentId) }),
      );
      await runner.exec(user, serverPlan(agentId));
    }
  }, 600_000);

  afterAll(async () => {
    await cleanup();
    if (root) await rm(root, { recursive: true, force: true });
  }, 120_000);

  test("two robots of one human both serve on port 3000, reachable by sandbox name", async () => {
    for (const agentId of ["a1", "a2"]) {
      const ports = await waitFor(
        () => runner.listPorts({ userId: "u1", agentId }),
        (p) => p.some((x) => x.port === 3000),
      );
      expect(ports.map((p) => p.port)).toContain(3000);
    }
    const a1 = infos.get("a1");
    const a2 = infos.get("a2");
    expect(a1?.host).toBe(sandboxName("a1"));
    expect(a1?.ports.first).not.toBe(a2?.ports.first);
    // From the human's runner, over the network, as the office's proxy would.
    const { containerId } = await runner.provision(user);
    for (const [agentId, info] of [
      ["a1", a1],
      ["a2", a2],
    ] as const) {
      const got = await engine.exec(containerId ?? "", {
        cmd: ["busybox", "wget", "-qO-", `http://${info?.host}:3000/`],
      });
      expect(got.stdout.trim()).toBe(`robot ${agentId} PORT=${info?.ports.first}`);
    }
  });

  test("limits apply inside the sandbox", async () => {
    const c = await inspect("a1");
    expect(c.HostConfig.Memory).toBe(settings.memoryBytes);
    expect(c.HostConfig.NanoCpus).toBe(1.5e9);
    expect(c.HostConfig.PidsLimit).toBe(settings.pids);
    const read = async (file: string) =>
      (await inSandbox("a1", ["cat", `/sys/fs/cgroup/${file}`])).stdout.trim();
    expect(await read("memory.max")).toBe(String(settings.memoryBytes));
    expect(await read("pids.max")).toBe(String(settings.pids));
    expect(await read("cpu.max")).toBe("150000 100000");
  });

  test("non-root, no socket, HOME and the human's own area only; no secrets in the config", async () => {
    const c = await inspect("a1");
    expect(c.Config.User).toBe("1001:1001");
    expect(c.HostConfig.Privileged).toBe(false);
    expect(c.HostConfig.Mounts.map((m) => m.Target).sort()).toEqual(
      ["/home/runner", area("u1")].sort(),
    );
    expect(JSON.stringify(c)).not.toContain("docker.sock");
    expect(JSON.stringify(c)).not.toContain(KEY);
    expect((await inSandbox("a1", ["id", "-u"])).stdout.trim()).toBe("1001");
    // Files the robot makes stay group-writable for the office (#150).
    const made = await inSandbox("a1", ["stat", "-c", "%a", "/home/runner/made-by-a1"]);
    expect(made.stdout.trim()).toBe("664");
    // The HOME volume is the human's: a2 sees what a1 made (CLI logins are shared).
    expect((await inSandbox("a2", ["test", "-e", "/home/runner/made-by-a1"])).code).toBe(0);
  });

  test("a sandbox sees neither another sandbox's processes nor another human's area", async () => {
    const procs = await runner.listProcesses({ userId: "u1", agentId: "a1" });
    expect(procs.filter((p) => p.command === "busybox" || p.command === "httpd")).toHaveLength(1);
    const comms = await inSandbox("a1", [
      "sh",
      "-c",
      'for d in /proc/[0-9]*; do cat "$d/comm" 2>/dev/null; done',
    ]);
    expect(comms.stdout.split("\n").filter((c) => c === "busybox" || c === "httpd")).toHaveLength(
      1,
    );
    expect((await inSandbox("a1", ["test", "-e", area("u2")])).code).not.toBe(0);
    expect((await inSandbox("a1", ["test", "-e", workdir("u1", "a2")])).code).toBe(0);
  });

  test("a fresh runner (office restart) re-adopts the sandboxes and their sessions", async () => {
    const again = new DockerRunner({
      engine: runnerEngine,
      image: IMAGE,
      prefix: PREFIX,
      user: "1001:1001",
      home: "/home/runner",
      labels: TEST_LABEL,
      pull: false,
      network: NETWORK,
      floorRoots: [join(root, "worktrees")],
      sandboxes: settings,
    });
    await again.recover();
    expect((await again.listSessions(user)).sort()).toEqual(["agent-a1", "agent-a2"]);
    const session = { userId: "u1", name: "agent-a2" };
    expect(await again.sessionExists(session)).toBe(true);
    const listed = await again.listSandboxes();
    expect(listed.find((s) => s.agentId === "a2")?.ports).toEqual(
      infos.get("a2")?.ports as SandboxInfo["ports"],
    );
    // Starting the robot again keeps its running sandbox.
    const id = (await inspect("a2")).Id;
    await again.sandbox({ userId: "u1", agentId: "a2" }, { workdir: workdir("u1", "a2") });
    expect((await inspect("a2")).Id).toBe(id);
  });

  test("stop removes the sandbox and its dev server; the other robot keeps running", async () => {
    await runner.kill({ userId: "u1", agentId: "a1" });
    const gone = await inspect("a1").then(
      () => 200,
      (e) => (e instanceof DockerApiError ? e.status : 0),
    );
    expect(gone).toBe(404);
    expect(await runner.sessionExists({ userId: "u1", name: "agent-a1" })).toBe(false);
    expect((await inspect("a2")).State.Running).toBe(true);
    expect((await runner.listSandboxes()).map((s) => s.agentId)).toEqual(["a2"]);
  });
});
