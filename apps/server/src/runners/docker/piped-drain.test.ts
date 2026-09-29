/**
 * #126: a piped side process (the spawn dialog's `claude auth status` login
 * check) that is still running when the first spawn on a floor needs the runner
 * recreated with the human's area. `mountProject` waits a bounded time for it
 * instead of refusing, and a `RunnerBusyError` names what is actually busy.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { SecretEnv, type SpawnPlan } from "@regulus/agent-adapters";
import { DockerRunner, RunnerBusyError } from "./docker-runner.ts";
import { EngineClient } from "./engine.ts";
import { pipedLabel } from "./piped-tracker.ts";
import { FakeEngine } from "./testing/fake-engine.ts";

const IMAGE = "runner:test";
const user = { userId: "u1" };
const area = "/srv/office/worktrees/f1/u1";
const repo = { floorId: "f1", repoId: "r1", workdir: `${area}/_clones/repo` };

let fake: FakeEngine;
let sessions: Set<string>;

beforeEach(async () => {
  fake = await FakeEngine.start();
  fake.images.add(IMAGE);
  sessions = new Set();
  fake.onExec = async (exec, io) => {
    const [bin, ...args] = exec.cmd;
    if (bin === "tmux") {
      if (args[2] === "new-session") sessions.add(args[args.indexOf("-s") + 1] ?? "");
      if (args[2] === "list-sessions") io.stdout([...sessions].map((s) => `${s}\n`).join(""));
      return 0;
    }
    if (bin === "sh" && (args[1] ?? "").includes("office-pid:")) {
      // A piped process: runs until one byte arrives on its stdin.
      io.stderr("office-pid:42\n");
      await io.readStdin(1);
      return 0;
    }
    return 0;
  };
});

afterEach(async () => {
  await fake.stop();
});

function runner(pipedDrainMs?: number): DockerRunner {
  return new DockerRunner({
    engine: new EngineClient(fake.dockerHost),
    image: IMAGE,
    prefix: "office",
    user: "1001:1001",
    home: "/home/runner",
    volumeMap: [{ path: "/srv/office/worktrees", volume: "regulus_worktrees" }],
    ...(pipedDrainMs === undefined ? {} : { pipedDrainMs }),
  });
}

function plan(agentId: string, argv: string[]): SpawnPlan {
  return {
    agentId,
    provider: "claude-code",
    argv,
    env: SecretEnv.of({ HOME: "/home/runner" }),
    cwd: "/home/runner",
    tmuxSession: `agent-${agentId}`,
    files: [],
  };
}

const creates = () => fake.calls("POST", "/containers/create").length;

describe("mountProject while a piped process runs (#126)", () => {
  test("waits for a login check to finish, then recreates with the human's area", async () => {
    const r = runner();
    const check = await r.spawnPiped(user, plan("status", ["claude", "auth", "status"]));
    expect(creates()).toBe(1);

    let mounted = false;
    const mounting = r.mountProject(user, repo).then((m) => {
      mounted = true;
      return m;
    });
    await Bun.sleep(150);
    expect(mounted).toBe(false); // still waiting for the check, not refused
    expect(creates()).toBe(1);

    await check.write("x");
    expect(await check.exited).toBe(0);
    expect(await mounting).toEqual({ workdir: repo.workdir });
    expect(creates()).toBe(2);
    const body = JSON.parse(fake.calls("POST", "/containers/create").at(-1)?.body ?? "{}");
    expect(body.HostConfig.Mounts.map((m: { Target: string }) => m.Target)).toEqual([
      "/home/runner",
      area,
    ]);
  });

  test("a piped process that outlives the bound is named in the error, not '0 tmux sessions'", async () => {
    const r = runner(100);
    const proc = await r.spawnPiped(user, plan("codex", ["/usr/bin/codex", "app-server"]));
    const started = Date.now();
    const err = await r.mountProject(user, repo).catch((e) => e);
    expect(Date.now() - started).toBeGreaterThanOrEqual(90);
    expect(err).toBeInstanceOf(RunnerBusyError);
    expect(err.sessions).toEqual([]);
    expect(err.piped).toEqual(["codex app-server"]);
    expect(err.message).toContain("1 piped process(es) still running (codex app-server)");
    expect(err.message).not.toContain("tmux");
    expect(creates()).toBe(1);
    await proc.write("x");
    await proc.exited;

    // Once it is gone the same mount goes through.
    await r.mountProject(user, repo);
    expect(creates()).toBe(2);
  });

  test("live tmux sessions refuse at once, without waiting for piped processes", async () => {
    const r = runner(10_000);
    await r.exec(user, plan("a1", ["claude"]));
    const proc = await r.spawnPiped(user, plan("status", ["claude", "auth", "status"]));
    const started = Date.now();
    const err = await r.mountProject(user, repo).catch((e) => e);
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(err).toBeInstanceOf(RunnerBusyError);
    expect(err.sessions).toEqual(["agent-a1"]);
    expect(err.piped).toEqual(["claude auth status"]);
    expect(err.message).toContain("1 tmux session(s) (agent-a1)");
    expect(err.message).toContain("(claude auth status)");
    expect(creates()).toBe(1);
    await proc.write("x");
    await proc.exited;
  });

  test("a mount the runner already has never waits", async () => {
    const r = runner(10_000);
    await r.mountProject(user, repo);
    const proc = await r.spawnPiped(user, plan("status", ["claude", "auth", "status"]));
    const started = Date.now();
    await r.mountProject(user, { ...repo, workdir: `${area}/agent-1` });
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(creates()).toBe(2);
    await proc.write("x");
    await proc.exited;
  });
});

describe("mount changes and piped processes started meanwhile", () => {
  const pipedExecs = () => [...fake.execs.values()].filter((e) => e.cmd.includes("status"));

  test("a login check started during a mount change runs in the new container", async () => {
    const r = runner();
    const first = await r.spawnPiped(user, plan("status", ["claude", "auth", "status"]));
    const mounting = r.mountProject(user, repo);
    await Bun.sleep(50);
    const second = r.spawnPiped(user, plan("status", ["claude", "auth", "status"]));
    await Bun.sleep(100);
    expect(pipedExecs()).toHaveLength(1); // held until the recreate is done

    await first.write("x");
    await mounting;
    const proc = await second;
    const { containerId } = await r.provision(user);
    expect(pipedExecs().at(-1)?.containerId).toBe(containerId as string);
    expect(pipedExecs()[0]?.containerId).not.toBe(containerId as string);
    await proc.write("x");
    await proc.exited;
  });

  test("two first spawns on different floors both keep their mounts", async () => {
    const r = runner();
    const other = "/srv/office/worktrees/f2/u1";
    await Promise.all([
      r.mountProject(user, repo),
      r.mountProject(user, { floorId: "f2", repoId: "r9", workdir: `${other}/_clones/repo` }),
    ]);
    const body = JSON.parse(fake.calls("POST", "/containers/create").at(-1)?.body ?? "{}");
    const targets = body.HostConfig.Mounts.map((m: { Target: string }) => m.Target);
    expect(targets.sort()).toEqual(["/home/runner", area, other].sort());
  });
});

describe("pipedLabel", () => {
  test("keeps the program and at most two plain subcommand words", () => {
    expect(pipedLabel(["claude", "auth", "status"])).toBe("claude auth status");
    expect(pipedLabel(["/usr/local/bin/codex", "app-server", "--listen", "x"])).toBe(
      "codex app-server",
    );
    expect(pipedLabel(["kimi", "--flag", "login"])).toBe("kimi");
    expect(pipedLabel(["a", "b", "c", "d"])).toBe("a b c");
  });
});
