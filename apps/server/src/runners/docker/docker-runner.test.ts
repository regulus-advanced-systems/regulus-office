/**
 * DockerRunner against a fake Engine API server (testing/fake-engine.ts): the
 * container create body (SPEC §8 hardening and the #95 socket-proxy limits),
 * provisioning, recovery, mount strategy, secret handling and the exec shapes
 * for tmux, piped processes and TTY attach.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { SecretEnv, type SpawnPlan } from "@regulus/agent-adapters";
import { LABEL_USER } from "./containers.ts";
import { DockerRunner, envFileContents, RunnerBusyError } from "./docker-runner.ts";
import { EngineClient } from "./engine.ts";
import { MountRefusedError } from "./mounts.ts";
import { type ExecHandler, FakeEngine } from "./testing/fake-engine.ts";

const IMAGE = "runner:test";
const KEY = "sk-unit-DO-NOT-LEAK";
const user = { userId: "u1" };

let fake: FakeEngine;
let runner: DockerRunner;
let sessions: Set<string>;
let written: Map<string, string>;

/** A tiny tmux/sh stand-in for the fake daemon. */
const tmuxish: ExecHandler = async (exec, io) => {
  const [bin, ...args] = exec.cmd;
  if (bin === "tmux") {
    const sub = args[2];
    const name = (args[args.indexOf("-t") + 1] ?? "").replace(/^=/, "").replace(/:$/, "");
    if (sub === "new-session") sessions.add(args[args.indexOf("-s") + 1] ?? "");
    if (sub === "list-sessions") io.stdout([...sessions].map((s) => `${s}\n`).join(""));
    if (sub === "has-session") return sessions.has(name) ? 0 : 1;
    if (sub === "kill-session") return sessions.delete(name) ? 0 : 1;
    if (sub === "capture-pane") io.stdout("FAKE AGENT READY\n");
    return 0;
  }
  if (bin === "sh" && args[0] === "-c") {
    const script = args[1] ?? "";
    if (script.includes("head -c")) {
      const [path = "", size = "0"] = args.slice(3);
      written.set(path, new TextDecoder().decode(await io.readStdin(Number(size))));
      return 0;
    }
    if (script.includes("office-pid:")) {
      io.stderr("office-pid:42\n");
      const line = new TextDecoder().decode(await io.readStdin(5));
      io.stdout(`got ${line}`);
      return 0;
    }
    if (script.includes("pane_pid")) {
      io.stdout("10\n10 (sh) S 1 10 10 0\n11 (node) S 10 10 10 0\n99 (other) S 1 99 99 0\n");
      return 0;
    }
  }
  return 0;
};

beforeEach(async () => {
  fake = await FakeEngine.start();
  fake.onExec = tmuxish;
  fake.images.add(IMAGE);
  sessions = new Set();
  written = new Map();
  runner = new DockerRunner({
    engine: new EngineClient(fake.dockerHost),
    image: IMAGE,
    prefix: "office",
    user: "1001:1001",
    home: "/home/runner",
    memoryBytes: 2 * 1024 ** 3,
    nanoCpus: 2e9,
    pidsLimit: 512,
    network: "office_runners",
  });
});

afterEach(async () => {
  await fake.stop();
});

function plan(agentId: string, argv = ["claude"]): SpawnPlan {
  return {
    agentId,
    provider: "custom",
    argv,
    env: SecretEnv.of({ HOME: "/home/runner", FAKE_API_KEY: KEY }),
    cwd: "/srv/office/projects/f1/repo",
    tmuxSession: `agent-${agentId}`,
    files: [],
  };
}

/** Everything that went over the wire except exec stdin (which is where secrets belong). */
function wireWithoutStdin(): string {
  return fake.requests.map((r) => `${r.method} ${r.path}?${r.query} ${r.body}`).join("\n");
}

describe("provision", () => {
  test("pulls a missing image and creates a hardened, labelled runner", async () => {
    fake.images.clear();
    const handle = await runner.provision(user);
    expect(handle).toMatchObject({
      userId: "u1",
      backend: "docker",
      home: "/home/runner",
      tmuxSocket: "/run/office/tmux/u1.sock",
    });
    expect(fake.calls("POST", "/images/create")[0]?.query.get("fromImage")).toBe(IMAGE);
    expect(fake.volumes.get("office-home-u1")?.Labels).toMatchObject({ [LABEL_USER]: "u1" });

    const create = fake.calls("POST", "/containers/create").at(-1);
    expect(create?.query.get("name")).toBe("office-runner-u1");
    const body = JSON.parse(create?.body ?? "{}");
    expect(body.User).toBe("1001:1001");
    expect(body.Env).toEqual(["IS_SANDBOX=1", "HOME=/home/runner"]);
    expect(body.Labels).toMatchObject({
      "org.regulus.office.role": "runner",
      "org.regulus.office.prefix": "office",
      [LABEL_USER]: "u1",
    });
    const host = body.HostConfig;
    expect(host.Mounts).toEqual([
      { Type: "volume", Source: "office-home-u1", Target: "/home/runner" },
    ]);
    expect(host.Tmpfs["/run/office/tmux"]).toContain("uid=1001");
    expect(host).toMatchObject({
      Init: true,
      CapDrop: ["ALL"],
      SecurityOpt: ["no-new-privileges"],
      Memory: 2 * 1024 ** 3,
      NanoCpus: 2e9,
      PidsLimit: 512,
      NetworkMode: "office_runners",
    });
  });

  test("create body stays inside what the socket proxy cannot police (#95)", async () => {
    await runner.provision(user);
    const body = JSON.parse(fake.calls("POST", "/containers/create")[0]?.body ?? "{}");
    const host = body.HostConfig;
    for (const key of ["Privileged", "CapAdd", "Devices", "DeviceRequests", "Binds"]) {
      expect(host[key]).toBeUndefined();
    }
    for (const key of ["PidMode", "IpcMode", "UTSMode", "UsernsMode", "CgroupnsMode"]) {
      expect(host[key]).toBeUndefined();
    }
    expect(host.NetworkMode).not.toBe("host");
    expect(JSON.stringify(body)).not.toContain("docker.sock");
    expect(body.User.startsWith("0:")).toBe(false);
  });

  test("is idempotent and restarts a stopped runner", async () => {
    const first = await runner.provision(user);
    const c = fake.containers.get(first.containerId ?? "");
    if (c) c.running = false;
    const again = await runner.provision(user);
    expect(again.containerId).toBe(first.containerId);
    expect(fake.calls("POST", "/containers/create")).toHaveLength(1);
    expect(c?.running).toBe(true);
  });

  test("refuses a root runner user and container names it does not own", async () => {
    expect(
      () => new DockerRunner({ image: IMAGE, prefix: "o", user: "0:0", home: "/root" }),
    ).toThrow(/non-root/);
    fake.images.add(IMAGE);
    fake.containers.set("x", {
      id: "x",
      name: "office-runner-u1",
      running: true,
      body: { Labels: {} },
    });
    await expect(runner.provision(user)).rejects.toThrow(/not an office runner/);
    await expect(runner.provision({ userId: "../evil" })).rejects.toThrow(/container names/);
  });

  test("recover re-adopts labelled runners and starts stopped ones", async () => {
    await runner.provision(user);
    await runner.provision({ userId: "u2" });
    for (const c of fake.containers.values()) c.running = false;
    const fresh = new DockerRunner({
      engine: new EngineClient(fake.dockerHost),
      image: IMAGE,
      prefix: "office",
      user: "1001:1001",
      home: "/home/runner",
    });
    const handles = await fresh.recover();
    expect(handles.map((h) => h.userId).sort()).toEqual(["u1", "u2"]);
    expect([...fake.containers.values()].every((c) => c.running)).toBe(true);
    const listCall = fake.calls("GET", "/containers/json")[0];
    expect(listCall?.query.get("filters")).toContain("org.regulus.office.role=runner");
  });
});

describe("exec", () => {
  test("starts tmux with an env file written over stdin; the key never hits argv or the API", async () => {
    const session = await runner.exec(user, plan("a1", ["claude", "--model", "x"]));
    expect(session).toEqual({ userId: "u1", name: "agent-a1" });
    expect(sessions.has("agent-a1")).toBe(true);

    const [envPath, envBody] = [...written.entries()].find(([p]) => p.includes("/env-")) ?? [];
    expect(envPath).toStartWith("/home/runner/.office/run/env-");
    expect(envBody).toContain(`export FAKE_API_KEY='${KEY}'`);

    const tmux = [...fake.execs.values()].find((e) => e.cmd.includes("new-session"));
    expect(tmux?.cmd).toContain("/run/office/tmux/u1.sock");
    expect(tmux?.cmd.at(-1)).toBe(
      `. '${envPath}'; rm -f '${envPath}'; exec 'claude' '--model' 'x'`,
    );
    expect(tmux?.env).toEqual([]);
    expect(wireWithoutStdin()).not.toContain(KEY);
  });

  test("writes plan files as the runner with their mode, contents via stdin", async () => {
    const p = {
      ...plan("a2"),
      files: [{ path: "/home/runner/.claude/hooks.json", contents: "{}", mode: 0o640 }],
    };
    await runner.exec(user, p);
    expect(written.get("/home/runner/.claude/hooks.json")).toBe("{}");
    const write = [...fake.execs.values()].find((e) =>
      e.cmd.includes("/home/runner/.claude/hooks.json"),
    );
    expect(write?.cmd.slice(-2)).toEqual(["2", "640"]);
    expect(write?.stdin).toBe(true);
  });

  test("session queries and kill go through tmux on the human's socket", async () => {
    const session = await runner.exec(user, plan("a1"));
    expect(await runner.sessionExists(session)).toBe(true);
    expect(await runner.sessionExists({ userId: "u1", name: "agent-a10" })).toBe(false);
    expect(await runner.listSessions(user)).toEqual(["agent-a1"]);
    expect(await runner.capturePane(session, 50)).toContain("FAKE AGENT READY");
    const procs = await runner.listProcesses({ userId: "u1", agentId: "a1" });
    expect(procs.map((p) => p.pid)).toEqual([10, 11]);
    await runner.kill({ userId: "u1", agentId: "a1" });
    expect(sessions.size).toBe(0);
    const killer = [...fake.execs.values()].find((e) => e.cmd.join(" ").includes("kill -9"));
    expect(killer?.cmd.slice(-2)).toEqual(["10", "11"]);
  });

  test("queries on a human without a runner are empty, not a new container", async () => {
    expect(await runner.listSessions({ userId: "nobody" })).toEqual([]);
    expect(await runner.readTextFile({ userId: "nobody" }, "/x")).toBeNull();
    expect(await runner.listProcesses({ userId: "nobody", agentId: "a" })).toEqual([]);
    await runner.kill({ userId: "nobody", agentId: "a" });
    expect(fake.calls("POST", "/containers/create")).toHaveLength(0);
  });

  test("re-resolves a runner that was removed behind its back", async () => {
    await runner.provision(user);
    fake.containers.clear();
    await runner.exec(user, plan("a1"));
    expect(fake.calls("POST", "/containers/create")).toHaveLength(2);
  });
});

describe("spawnPiped", () => {
  test("passes env as exec-scoped Env and streams stdio", async () => {
    const proc = await runner.spawnPiped(user, plan("a3", ["codex", "app-server"]));
    expect(proc.pid).toBe(42);
    const exec = [...fake.execs.values()].find((e) => e.cmd.includes("codex"));
    expect(exec?.env).toContain(`FAKE_API_KEY=${KEY}`);
    expect(exec?.cmd.slice(-2)).toEqual(["codex", "app-server"]);
    await proc.write("ping\n");
    expect(await new Response(proc.stdout).text()).toBe("got ping\n");
    expect(await proc.exited).toBe(0);
    // The key rides only in the exec create body, never the container.
    const create = fake.calls("POST", "/containers/create")[0];
    expect(create?.body).not.toContain(KEY);
  });

  test("kill signals the in-container pid", async () => {
    const proc = await runner.spawnPiped(user, plan("a3"));
    proc.kill("SIGTERM");
    await Bun.sleep(50);
    const kill = [...fake.execs.values()].find((e) => e.cmd[0] === "kill");
    expect(kill?.cmd).toEqual(["kill", "-s", "TERM", "42"]);
    await proc.write("bye!\n");
    await proc.exited;
  });
});

describe("attach", () => {
  test("returns a TTY stream; watch is read-only", async () => {
    await runner.provision(user);
    fake.onExec = async (_exec, io) => {
      io.stdout("screen");
      await io.readStdin(1);
      return 0;
    };
    const watch = runner.attach({ userId: "u1", name: "agent-a1" }, "watch");
    expect(watch.kind).toBe("stream");
    const tty = await watch.open({ cols: 160, rows: 45 });
    const exec = [...fake.execs.values()].at(-1);
    expect(exec?.tty).toBe(true);
    expect(exec?.cmd).toEqual([
      ...["tmux", "-S", "/run/office/tmux/u1.sock", "attach-session", "-r", "-t", "=agent-a1"],
    ]);
    await tty.resize({ cols: 100, rows: 30 });
    const resize = fake.calls("POST", /\/resize$/)[0];
    expect([resize?.query.get("h"), resize?.query.get("w")]).toEqual(["30", "100"]);
    await tty.write("q");
    expect(await new Response(tty.output).text()).toBe("screen");
    await tty.closed;

    const control = runner.attach({ userId: "u1", name: "agent-a1" }, "control");
    fake.onExec = () => 0;
    await (await control.open({ cols: 80, rows: 24 })).closed;
    expect([...fake.execs.values()].at(-1)?.cmd).not.toContain("-r");
  });
});

describe("mountProject", () => {
  // u1's runner id is "u1" (short ids are used as they are, runners/layout.ts).
  const area = "/srv/office/worktrees/f1/u1";
  const repo = { floorId: "f1", repoId: "r1", workdir: `${area}/_clones/repo` };
  const volumes = () =>
    new DockerRunner({
      engine: new EngineClient(fake.dockerHost),
      image: IMAGE,
      prefix: "office",
      user: "1001:1001",
      home: "/home/runner",
      volumeMap: [{ path: "/srv/office/worktrees", volume: "regulus_worktrees" }],
    });
  const createdMounts = () =>
    JSON.parse(fake.calls("POST", "/containers/create").at(-1)?.body ?? "{}").HostConfig.Mounts;

  test("recreates an idle runner with the human's own area on the floor, keeping HOME", async () => {
    runner = volumes();
    const before = await runner.provision(user);
    expect(await runner.mountProject(user, repo)).toEqual({ workdir: repo.workdir });
    const after = await runner.provision(user);
    expect(after.containerId).not.toBe(before.containerId);
    expect(createdMounts()).toEqual([
      { Type: "volume", Source: "office-home-u1", Target: "/home/runner" },
      {
        Type: "volume",
        Source: "regulus_worktrees",
        Target: area,
        VolumeOptions: { Subpath: "f1/u1" },
      },
    ]);

    // Another repo's clone and an agent worktree in the same area: no recreate.
    await runner.mountProject(user, { ...repo, repoId: "r2", workdir: `${area}/_clones/b` });
    await runner.mountProject(user, { ...repo, workdir: `${area}/agent-1` });
    expect(fake.calls("POST", "/containers/create")).toHaveLength(2);
  });

  test("never mounts a mirror, a floor dir or another human's area", async () => {
    for (const workdir of [
      "/srv/office/projects/f1/repo",
      "/srv/office/worktrees/f1",
      "/srv/office/worktrees/f1/agent-1",
      "/srv/office/worktrees/f1/u2/_clones/repo",
    ]) {
      const err = await runner.mountProject(user, { ...repo, workdir }).catch((e) => e);
      expect(err).toBeInstanceOf(MountRefusedError);
    }
    expect(fake.calls("POST", "/containers/create")).toHaveLength(0);
  });

  test("refuses to recreate a runner with live sessions", async () => {
    await runner.exec(user, plan("a1"));
    const err = await runner.mountProject(user, repo).catch((e) => e);
    expect(err).toBeInstanceOf(RunnerBusyError);
    expect(err.sessions).toEqual(["agent-a1"]);
    expect(fake.calls("POST", "/containers/create")).toHaveLength(1);
  });

  describe("whole-floor mounts from before per-human clones (#114)", () => {
    const legacy = [
      { Type: "bind", Source: "/srv/office/projects/f1", Target: "/srv/office/projects/f1" },
      { Type: "bind", Source: "/srv/office/worktrees/f1", Target: "/srv/office/worktrees/f1" },
    ] as const;
    const legacyRunner = async () => {
      runner = volumes();
      await runner.provision(user);
      await runner.containers.recreate(user.userId, [...legacy]);
    };

    test("reconcileMounts drops them from an idle runner", async () => {
      await legacyRunner();
      expect(await runner.reconcileMounts(user)).toBe(true);
      expect(createdMounts()).toEqual([
        { Type: "volume", Source: "office-home-u1", Target: "/home/runner" },
      ]);
      expect(await runner.reconcileMounts(user)).toBe(true);
      expect(fake.calls("POST", "/containers/create")).toHaveLength(3);
    });

    test("a busy runner keeps them, and gets no new mounts or agents while it does", async () => {
      await legacyRunner();
      await runner.exec(user, plan("a1"));
      expect(await runner.reconcileMounts(user)).toBe(false);
      // Already covered by the floor mount, but the stale mount alone refuses it.
      const err = await runner.mountProject(user, repo).catch((e) => e);
      expect(err).toBeInstanceOf(RunnerBusyError);
      expect(err.missing).toContain("-/srv/office/projects/f1");
    });

    test("mountProject replaces them with the human's area when idle", async () => {
      await legacyRunner();
      await runner.mountProject(user, repo);
      expect(createdMounts().map((m: { Target: string }) => m.Target)).toEqual([
        "/home/runner",
        area,
      ]);
    });
  });
});

describe("files", () => {
  test("readTextFile distinguishes absent files", async () => {
    await runner.provision(user);
    fake.onExec = (exec, io) => {
      if (exec.cmd.at(-1) === "/missing") return 44;
      io.stdout("contents");
      return 0;
    };
    expect(await runner.readTextFile(user, "/missing")).toBeNull();
    expect(await runner.readTextFile(user, "/home/runner/x")).toBe("contents");
  });

  test("envFileContents quotes values for sh", async () => {
    const text = envFileContents({ A: "it's $HOME `x`" });
    const out = await Bun.$`sh -c ${`${text}printf %s "$A"`}`.text();
    expect(out).toBe("it's $HOME `x`");
  });
});
