/**
 * Per-agent sandboxes of the docker backend (#169) against the fake Engine API:
 * the sandbox create body (hardening, HOME plus the human's own area only,
 * limits, ports, network, labels), which container each call runs in,
 * kill/remove, re-adoption by a fresh runner, self-heal, and that robots in
 * sandboxes no longer keep the human's runner from being recreated.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SecretEnv, type SpawnPlan } from "@regulus/agent-adapters";
import { DEFAULT_SANDBOX_SETTINGS, type SandboxSettings } from "../sandbox.ts";
import { LABEL_PREFIX, LABEL_ROLE, LABEL_USER } from "./containers.ts";
import { DockerRunner } from "./docker-runner.ts";
import { EngineClient } from "./engine.ts";
import { MountRefusedError } from "./mounts.ts";
import { LABEL_AGENT, LABEL_PORTS } from "./sandboxes.ts";
import { type ExecHandler, type FakeContainer, FakeEngine } from "./testing/fake-engine.ts";

const IMAGE = "runner:test";
const KEY = "sk-sandbox-unit-DO-NOT-LEAK";
const user = { userId: "u1" };
const settings: SandboxSettings = {
  ...DEFAULT_SANDBOX_SETTINGS,
  memoryBytes: 1024 ** 3,
  cpus: 1.5,
  pids: 300,
};

let fake: FakeEngine;
let root: string;
/** tmux sessions per container id. */
let sessions: Map<string, Set<string>>;
/** Files written per container id. */
let written: Map<string, Map<string, string>>;

const inContainer = <T>(map: Map<string, T>, id: string, make: () => T): T => {
  const found = map.get(id);
  if (found) return found;
  const made = make();
  map.set(id, made);
  return made;
};

const tmuxish: ExecHandler = async (exec, io) => {
  const [bin, ...args] = exec.cmd;
  const mine = inContainer(sessions, exec.containerId, () => new Set<string>());
  if (bin === "tmux") {
    const sub = args[2];
    const name = (args[args.indexOf("-t") + 1] ?? "").replace(/^=/, "").replace(/:$/, "");
    if (sub === "new-session") mine.add(args[args.indexOf("-s") + 1] ?? "");
    if (sub === "list-sessions") {
      if (mine.size === 0) {
        io.stderr("no server running on /run/office/tmux/u1.sock\n");
        return 1;
      }
      io.stdout([...mine].map((s) => `${s}\n`).join(""));
    }
    if (sub === "has-session") return mine.has(name) ? 0 : 1;
    if (sub === "kill-session") return mine.delete(name) ? 0 : 1;
    if (sub === "capture-pane") io.stdout(`screen of ${exec.containerId}\n`);
    return 0;
  }
  if (bin === "sh" && args[0] === "-c") {
    const script = args[1] ?? "";
    if (script.includes("paste-buffer")) {
      await io.readStdin(Number(args[6] ?? 0));
      return 0;
    }
    if (script.includes("head -c")) {
      const [path = "", size = "0"] = args.slice(3);
      const files = inContainer(written, exec.containerId, () => new Map<string, string>());
      files.set(path, new TextDecoder().decode(await io.readStdin(Number(size))));
      return 0;
    }
    if (script.startsWith('echo "$$"')) {
      // SANDBOX_PROCESS_SCRIPT: pid 1 init, 7 sleep, 8 tmux server, the agent, a detached server.
      io.stdout(
        "50\n1 (docker-init) S 0 1 1 0\n7 (sleep) S 1 7 7 0\n8 (tmux: server) S 1 8 8 0\n" +
          "9 (claude) S 8 9 9 0\n12 (vite) S 1 12 12 0\n50 (sh) S 0 50 50 0\n51 (cat) S 50 50 50 0\n",
      );
      return 0;
    }
  }
  return 0;
};

function runner(opts: { sandboxes?: SandboxSettings | null } = {}): DockerRunner {
  return new DockerRunner({
    engine: new EngineClient(fake.dockerHost),
    image: IMAGE,
    prefix: "office",
    user: "1001:1001",
    home: "/home/runner",
    network: "office_runners",
    floorRoots: [join(root, "worktrees")],
    volumeMap: [{ path: join(root, "worktrees"), volume: "office_worktrees" }],
    sandboxes: opts.sandboxes === null ? undefined : (opts.sandboxes ?? settings),
  });
}

const area = (rid = "u1", floor = "f1") => join(root, "worktrees", floor, rid);
const workdir = (agentId: string, rid = "u1") => join(area(rid), agentId);

function plan(agentId: string, cwd = workdir(agentId)): SpawnPlan {
  return {
    agentId,
    provider: "custom",
    argv: ["claude"],
    env: SecretEnv.of({ FAKE_API_KEY: KEY }),
    cwd,
    tmuxSession: `agent-${agentId}`,
    files: [
      { path: `/home/runner/.office/${agentId}/hook.sh`, contents: "#!/bin/sh\n", mode: 0o700 },
    ],
  };
}

const sandboxOf = (agentId: string): FakeContainer | undefined =>
  [...fake.containers.values()].find((c) => c.name === `office-sbx-${agentId}`);
const runnerOf = (userId = "u1"): FakeContainer | undefined =>
  [...fake.containers.values()].find((c) => c.name === `office-runner-${userId}`);
const hostConfig = (c: FakeContainer | undefined) =>
  (c?.body.HostConfig ?? {}) as Record<string, unknown>;
const execsIn = (c: FakeContainer | undefined) =>
  [...fake.execs.values()].filter((e) => e.containerId === c?.id);

beforeEach(async () => {
  fake = await FakeEngine.start();
  fake.onExec = tmuxish;
  fake.images.add(IMAGE);
  sessions = new Map();
  written = new Map();
  root = await mkdtemp(join(tmpdir(), "rgo-sbx-unit-"));
});

afterEach(async () => {
  await fake.stop();
  await rm(root, { recursive: true, force: true });
});

describe("sandbox()", () => {
  test("creates a hardened container with HOME and the human's own area only", async () => {
    const r = runner();
    const info = await r.sandbox({ userId: "u1", agentId: "a1" }, { workdir: workdir("a1") });
    const c = sandboxOf("a1");
    expect(c?.running).toBe(true);
    expect(info).toMatchObject({ userId: "u1", agentId: "a1", host: "office-sbx-a1" });
    const body = c?.body as Record<string, unknown>;
    expect(body.User).toBe("1001:1001");
    expect(body.Image).toBe(IMAGE);
    const ports = info?.ports ?? { first: 0, last: 0 };
    expect(ports.last - ports.first).toBe(settings.portSpan - 1);
    expect(body.Env).toEqual([
      "IS_SANDBOX=1",
      "HOME=/home/runner",
      `PORT=${ports.first}`,
      `OFFICE_SANDBOX_PORTS=${ports.first}-${ports.last}`,
    ]);
    expect(body.Labels).toMatchObject({
      [LABEL_ROLE]: "sandbox",
      [LABEL_PREFIX]: "office",
      [LABEL_USER]: "u1",
      [LABEL_AGENT]: "a1",
      [LABEL_PORTS]: `${ports.first}-${ports.last}`,
    });
    const hc = hostConfig(c);
    expect(hc.Mounts).toEqual([
      { Type: "volume", Source: "office-home-u1", Target: "/home/runner" },
      {
        Type: "volume",
        Source: "office_worktrees",
        Target: area(),
        VolumeOptions: { Subpath: "f1/u1" },
      },
    ]);
    expect(hc).toMatchObject({
      Init: true,
      CapDrop: ["ALL"],
      SecurityOpt: ["no-new-privileges"],
      NetworkMode: "office_runners",
      RestartPolicy: { Name: "no" },
      Memory: 1024 ** 3,
      MemorySwap: 1024 ** 3,
      NanoCpus: 1.5e9,
      PidsLimit: 300,
    });
    for (const key of ["Privileged", "CapAdd", "Devices", "PidMode", "IpcMode", "Binds"]) {
      expect(hc[key]).toBeUndefined();
    }
    expect(JSON.stringify(body)).not.toContain("docker.sock");
    // The HOME volume it shares is the runner's (created with it).
    expect(runnerOf()?.running).toBe(true);
  });

  test("is idempotent and keeps the agent's ports; two robots never share ports", async () => {
    const r = runner();
    const a1 = await r.sandbox({ userId: "u1", agentId: "a1" }, { workdir: workdir("a1") });
    const again = await r.sandbox({ userId: "u1", agentId: "a1" }, { workdir: workdir("a1") });
    const a2 = await r.sandbox({ userId: "u1", agentId: "a2" }, { workdir: workdir("a2") });
    expect(again?.ports).toEqual(a1?.ports as NonNullable<typeof a1>["ports"]);
    expect(fake.calls("POST", "/containers/create").length).toBe(3); // runner + 2 sandboxes
    expect(a2?.ports.first).not.toBe(a1?.ports.first);
    expect(await r.listSandboxes()).toHaveLength(2);
  });

  test("refuses a workdir outside the human's own area", async () => {
    const r = runner();
    const other = workdir("a1", "u2");
    await expect(r.sandbox({ userId: "u1", agentId: "a1" }, { workdir: other })).rejects.toThrow(
      MountRefusedError,
    );
    expect(sandboxOf("a1")).toBeUndefined();
  });

  test("returns null (robots stay in the runner) when sandboxes are off", async () => {
    const r = runner({ sandboxes: null });
    expect(await r.sandbox({ userId: "u1", agentId: "a1" }, { workdir: workdir("a1") })).toBeNull();
    expect(await r.listSandboxes()).toEqual([]);
  });

  test("replaces a stopped sandbox, and one whose start fails with a broken layer", async () => {
    const r = runner();
    await r.sandbox({ userId: "u1", agentId: "a1" }, { workdir: workdir("a1") });
    const first = sandboxOf("a1");
    if (first) first.running = false;
    let failures = 1;
    fake.onStart = (c) =>
      c.name === "office-sbx-a1" && failures-- > 0
        ? { status: 500, message: `RWLayer of container ${c.id} is unexpectedly nil` }
        : undefined;
    await r.sandbox({ userId: "u1", agentId: "a1" }, { workdir: workdir("a1") });
    const now = sandboxOf("a1");
    expect(now?.running).toBe(true);
    expect(now?.id).not.toBe(first?.id);
    expect([...fake.containers.values()].filter((c) => c.name === "office-sbx-a1")).toHaveLength(1);
  });
});

describe("calls about a sandboxed robot run in its sandbox", () => {
  test("exec, files and the env file go to the sandbox; a login stays in the runner", async () => {
    const r = runner();
    await r.sandbox({ userId: "u1", agentId: "a1" }, { workdir: workdir("a1") });
    const session = await r.exec(user, plan("a1"));
    expect(session).toEqual({ userId: "u1", name: "agent-a1" });
    const sb = sandboxOf("a1");
    expect(sessions.get(sb?.id ?? "")?.has("agent-a1")).toBe(true);
    const files = written.get(sb?.id ?? "") ?? new Map();
    expect(files.get("/home/runner/.office/a1/hook.sh")).toBe("#!/bin/sh\n");
    const envFile = [...files.keys()].find((p) => p.includes("/.office/run/env-"));
    expect(files.get(envFile ?? "")).toContain(KEY);
    const newSession = execsIn(sb).find((e) => e.cmd.includes("new-session"));
    expect(newSession?.cmd.at(-1)).toStartWith("umask 0002; ");
    // Secrets only on stdin: never on argv, the container config or any URL.
    const wire = fake.requests.map((q) => `${q.path}?${q.query} ${q.body}`).join("\n");
    expect(wire).not.toContain(KEY);

    await r.exec(user, { ...plan("login-u1"), cwd: "/home/runner" });
    expect(sessions.get(runnerOf()?.id ?? "")?.has("agent-login-u1")).toBe(true);
    expect(sessions.get(sb?.id ?? "")?.has("agent-login-u1")).toBeFalsy();
  });

  test("session, process and port calls go to the sandbox", async () => {
    const r = runner();
    await r.sandbox({ userId: "u1", agentId: "a1" }, { workdir: workdir("a1") });
    await r.exec(user, plan("a1"));
    const ref = { userId: "u1", name: "agent-a1" };
    expect(await r.capturePane(ref, 10)).toBe(`screen of ${sandboxOf("a1")?.id}\n`);
    expect(await r.sessionExists(ref)).toBe(true);
    await r.sendKeys(ref, "hello", { enter: true });
    const procs = await r.listProcesses({ userId: "u1", agentId: "a1" });
    // The agent and what it detached, not the sandbox's plumbing or the listing itself.
    expect(procs.map((p) => p.command)).toEqual(["claude", "vite"]);
    const sbExecs = execsIn(sandboxOf("a1")).map((e) => e.cmd.join(" "));
    expect(sbExecs.some((c) => c.includes("paste-buffer"))).toBe(true);
    expect(execsIn(runnerOf()).some((e) => e.cmd.join(" ").includes("paste-buffer"))).toBe(false);
    const tty = r.attach(ref, "watch");
    expect(tty.kind).toBe("stream");
  });

  test("piped processes of a sandboxed robot run in the sandbox with exec-scoped env", async () => {
    const r = runner();
    await r.sandbox({ userId: "u1", agentId: "a1" }, { workdir: workdir("a1") });
    fake.onExec = async (exec, io) => {
      if (exec.cmd.join(" ").includes("office-pid:")) {
        io.stderr("office-pid:42\n");
        return 0;
      }
      return tmuxish(exec, io);
    };
    const proc = await r.spawnPiped(user, { ...plan("a1"), argv: ["codex", "app-server"] });
    expect(proc.pid).toBe(42);
    const piped = execsIn(sandboxOf("a1")).find((e) => e.cmd.includes("app-server"));
    expect(piped?.env).toContain(`FAKE_API_KEY=${KEY}`);
    await proc.exited;
  });

  test("listSessions has the runner's and every sandbox's sessions", async () => {
    const r = runner();
    await r.sandbox({ userId: "u1", agentId: "a1" }, { workdir: workdir("a1") });
    await r.sandbox({ userId: "u1", agentId: "a2" }, { workdir: workdir("a2") });
    await r.exec(user, plan("a1"));
    await r.exec(user, plan("a2"));
    await r.exec(user, { ...plan("login-u1"), cwd: "/home/runner" });
    expect((await r.listSessions(user)).sort()).toEqual(["agent-a1", "agent-a2", "agent-login-u1"]);
  });
});

describe("kill and re-adoption", () => {
  test("kill removes the sandbox and everything in it; other robots are left alone", async () => {
    const r = runner();
    await r.sandbox({ userId: "u1", agentId: "a1" }, { workdir: workdir("a1") });
    await r.sandbox({ userId: "u1", agentId: "a2" }, { workdir: workdir("a2") });
    await r.exec(user, plan("a1"));
    await r.kill({ userId: "u1", agentId: "a1" });
    expect(sandboxOf("a1")).toBeUndefined();
    expect(sandboxOf("a2")?.running).toBe(true);
    expect(await r.sessionExists({ userId: "u1", name: "agent-a1" })).toBe(false);
    // Idempotent.
    await r.kill({ userId: "u1", agentId: "a1" });
    expect((await r.listSandboxes()).map((s) => s.agentId)).toEqual(["a2"]);
  });

  test("a fresh runner (office restart) finds the sandboxes and their sessions", async () => {
    const before = runner();
    const info = await before.sandbox({ userId: "u1", agentId: "a1" }, { workdir: workdir("a1") });
    await before.exec(user, plan("a1"));

    const after = runner();
    await after.recover();
    expect(await after.listSessions(user)).toEqual(["agent-a1"]);
    const ref = { userId: "u1", name: "agent-a1" };
    expect(await after.capturePane(ref, 5)).toBe(`screen of ${sandboxOf("a1")?.id}\n`);
    expect(await after.listSandboxes()).toEqual([
      expect.objectContaining({ agentId: "a1", userId: "u1", ports: info?.ports }),
    ]);
    // A start after the restart keeps the running sandbox (and its ports).
    const id = sandboxOf("a1")?.id;
    const again = await after.sandbox({ userId: "u1", agentId: "a1" }, { workdir: workdir("a1") });
    expect(again?.ports).toEqual(info?.ports as NonNullable<typeof info>["ports"]);
    expect(sandboxOf("a1")?.id).toBe(id as string);
  });

  test("a sandbox that vanished is forgotten: its session is simply gone", async () => {
    const r = runner();
    await r.sandbox({ userId: "u1", agentId: "a1" }, { workdir: workdir("a1") });
    await r.exec(user, plan("a1"));
    const sb = sandboxOf("a1");
    if (sb) fake.containers.delete(sb.id);
    expect(await r.sessionExists({ userId: "u1", name: "agent-a1" })).toBe(false);
    expect(await r.listSessions(user)).toEqual([]);
  });

  test("deprovision removes the human's sandboxes with the runner", async () => {
    const r = runner();
    await r.sandbox({ userId: "u1", agentId: "a1" }, { workdir: workdir("a1") });
    await r.deprovision(user);
    expect(sandboxOf("a1")).toBeUndefined();
    expect(runnerOf()).toBeUndefined();
  });

  test("robots in sandboxes do not keep the runner from getting a new floor mounted", async () => {
    const r = runner();
    await r.sandbox({ userId: "u1", agentId: "a1" }, { workdir: workdir("a1") });
    await r.exec(user, plan("a1"));
    const before = runnerOf()?.id;
    const repo = { floorId: "f2", repoId: "r", workdir: join(area("u1", "f2"), "_clones", "r") };
    await r.mountProject(user, repo);
    expect(runnerOf()?.id).not.toBe(before);
    expect(sandboxOf("a1")?.running).toBe(true);
  });
});
