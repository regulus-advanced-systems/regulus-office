/**
 * #151: a runner container broken by the host's Docker storage (start answers
 * `500 RWLayer of container … is unexpectedly nil`) is replaced instead of
 * being reused forever; the HOME volume stays; a running runner, and one with
 * live tmux sessions, is never replaced; a rebuilt runner image reaches idle
 * runners on their next use.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { SecretEnv, type SpawnPlan } from "@regulus/agent-adapters";
import { startFailure, startFailureReason } from "../../agents/manager/failure.ts";
import { DockerRunner, RunnerBusyError } from "./docker-runner.ts";
import { DockerApiError, EngineClient } from "./engine.ts";
import { classifyStartFailure } from "./heal.ts";
import { RunnerImageMissingError } from "./image.ts";
import { strictSessions } from "./refresh.ts";
import { FakeEngine } from "./testing/fake-engine.ts";

const IMAGE = "runner:test";
const user = { userId: "u1" };
const LONG_ID = "4f1c".repeat(16);
const RWLAYER = `RWLayer of container ${LONG_ID} is unexpectedly nil`;
const AREA = "/srv/office/worktrees/f1/u1";
const AREA_MOUNT = { Type: "bind" as const, Source: AREA, Target: AREA };

let fake: FakeEngine;
let sessions: Set<string>;
let logged: { obj: Record<string, unknown>; msg: string }[];
/** Resolves a pending `tmux new-session` in the fake (see the session race test). */
let releaseNewSession: (() => void) | null;
let newSessionSeen: Promise<void>;

beforeEach(async () => {
  fake = await FakeEngine.start();
  fake.images.add(IMAGE);
  sessions = new Set();
  logged = [];
  releaseNewSession = null;
  let seen: () => void = () => {};
  newSessionSeen = new Promise((r) => {
    seen = r;
  });
  fake.onExec = async (exec, io) => {
    const [bin, ...args] = exec.cmd;
    if (bin === "tmux") {
      if (args[2] === "new-session") {
        seen();
        if (releaseNewSession === null) {
          await new Promise<void>((r) => {
            releaseNewSession = r;
          });
        }
        sessions.add(args[args.indexOf("-s") + 1] ?? "");
      }
      if (args[2] === "list-sessions") {
        if (sessions.size === 0) {
          io.stderr("no server running on /run/office/tmux/u1.sock\n");
          return 1;
        }
        io.stdout([...sessions].map((s) => `${s}\n`).join(""));
      }
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
  releaseNewSession?.();
  await fake.stop();
});

function makeRunner(opts: { pull?: boolean } = {}): DockerRunner {
  return new DockerRunner({
    engine: new EngineClient(fake.dockerHost),
    image: IMAGE,
    prefix: "office",
    user: "1001:1001",
    home: "/home/runner",
    pipedDrainMs: 0,
    imageIdTtlMs: 0,
    floorRoots: ["/srv/office/worktrees"],
    logger: { warn: (obj, msg) => void logged.push({ obj, msg }) },
    ...opts,
  });
}

function plan(agentId: string, argv: string[]): SpawnPlan {
  return {
    agentId,
    provider: "custom",
    argv,
    env: SecretEnv.empty(),
    cwd: "/home/runner",
    tmuxSession: `agent-${agentId}`,
    files: [],
  };
}

/** The human's runner in the fake daemon (exactly one expected). */
function only() {
  const all = [...fake.containers.values()];
  expect(all).toHaveLength(1);
  return all[0] as NonNullable<(typeof all)[0]>;
}

/** Provision a runner with the human's area mounted, then stop it (as after a host restart). */
async function stoppedRunner(runner: DockerRunner): Promise<string> {
  await runner.provision(user);
  const c = await runner.containers.recreate(user.userId, [AREA_MOUNT]);
  (fake.containers.get(c.id) as { running: boolean }).running = false;
  return c.id;
}

const homeMount = (body: Record<string, unknown>) =>
  ((body.HostConfig as { Mounts: { Type?: string; Source?: string; Target: string }[] }).Mounts ??
    [])[0];

describe("broken runner containers are replaced (#151)", () => {
  test("a start that fails with the RWLayer 500 recreates the runner and keeps HOME", async () => {
    const runner = makeRunner();
    const broken = await stoppedRunner(runner);
    fake.onStart = (c) => (c.id === broken ? { status: 500, message: RWLAYER } : undefined);

    const handle = await runner.provision(user);

    expect(handle.containerId).not.toBe(broken);
    expect(fake.containers.has(broken)).toBe(false);
    const c = only();
    expect(c.running).toBe(true);
    // Same HOME volume, never deleted; the human's own area is mounted again, nothing else.
    expect(homeMount(c.body)).toEqual({
      Type: "volume",
      Source: "office-home-u1",
      Target: "/home/runner",
    });
    expect((c.body.HostConfig as { Mounts: unknown[] }).Mounts).toContainEqual(AREA_MOUNT);
    expect((c.body.HostConfig as { Mounts: unknown[] }).Mounts).toHaveLength(2);
    expect(fake.volumes.has("office-home-u1")).toBe(true);
    expect(fake.calls("DELETE", /^\/volumes\//)).toHaveLength(0);
    // Logged once, with the reason redacted (no container id, no path).
    expect(logged).toHaveLength(1);
    expect(logged[0]?.msg).toContain("recreating runner container");
    const reason = String(logged[0]?.obj.reason);
    expect(reason).toContain("RWLayer of container [redacted] is unexpectedly nil");
    expect(reason).not.toContain(LONG_ID);
    expect(reason).not.toContain("/containers/");
  });

  test("a container in the dead state is recreated without trying to start it", async () => {
    const runner = makeRunner();
    const dead = await stoppedRunner(runner);
    (fake.containers.get(dead) as { status?: string }).status = "dead";
    const starts = fake.calls("POST", `/containers/${dead}/start`).length;
    const handle = await runner.provision(user);
    expect(handle.containerId).not.toBe(dead);
    expect(fake.calls("POST", `/containers/${dead}/start`)).toHaveLength(starts);
    expect(only().running).toBe(true);
  });

  test("an unknown 500 is retried once; one that repeats recreates", async () => {
    const runner = makeRunner();
    const first = await stoppedRunner(runner);
    let failures = 1;
    fake.onStart = () => (failures-- > 0 ? { status: 500, message: "driver hiccup" } : undefined);
    expect((await runner.provision(user)).containerId).toBe(first);
    expect(logged).toHaveLength(0);

    (fake.containers.get(first) as { running: boolean }).running = false;
    fake.onStart = (c) => (c.id === first ? { status: 500, message: "driver broken" } : undefined);
    const starts = fake.calls("POST", `/containers/${first}/start`).length;
    const handle = await makeRunner().provision(user);
    expect(handle.containerId).not.toBe(first);
    expect(fake.calls("POST", `/containers/${first}/start`)).toHaveLength(starts + 2);
    expect(only().running).toBe(true);
  });

  test("other refusals are reported, not healed", async () => {
    const runner = makeRunner();
    const id = await stoppedRunner(runner);
    fake.onStart = () => ({ status: 409, message: "cannot start a paused container" });
    const err = await runner.provision(user).catch((e) => e);
    expect(err).toBeInstanceOf(DockerApiError);
    expect(fake.containers.has(id)).toBe(true);
    expect(startFailure(err).code).toBe("runner_api");
  });

  test("when the new container cannot start either, the Docker message is the reason", async () => {
    const runner = makeRunner();
    await stoppedRunner(runner);
    fake.onStart = () => ({ status: 500, message: RWLAYER });
    const err = await runner.provision(user).catch((e) => e);
    expect(err).toBeInstanceOf(DockerApiError);
    expect(startFailureReason(err)).toMatch(
      /^runner_api: Docker Engine: POST <path>: 500 RWLayer of container \[redacted\] is unexpectedly nil$/,
    );
    expect(fake.volumes.has("office-home-u1")).toBe(true);
  });

  test("a runner that cannot be inspected is replaced only if the list says it is stopped", async () => {
    const runner = makeRunner();
    const id = await stoppedRunner(runner);
    fake.onInspect = (c) => (c.id === id ? { status: 500, message: RWLAYER } : undefined);
    const handle = await runner.provision(user);
    expect(handle.containerId).not.toBe(id);
    expect(fake.volumes.has("office-home-u1")).toBe(true);

    const running = only();
    fake.onInspect = (c) => (c.id === running.id ? { status: 500, message: RWLAYER } : undefined);
    await expect(makeRunner().provision(user)).rejects.toThrow(/RWLayer/);
    expect(fake.containers.has(running.id)).toBe(true);
  });

  test("a running runner is never replaced, whatever start would say", async () => {
    const runner = makeRunner();
    releaseNewSession = () => {};
    await runner.exec(user, plan("a1", ["claude"]));
    const before = only().id;
    fake.onStart = () => ({ status: 500, message: RWLAYER });
    fake.imageIds.set(IMAGE, "sha256:rebuilt");
    const handle = await makeRunner().provision(user);
    expect(handle.containerId).toBe(before);
    expect(fake.calls("DELETE", /^\/containers\//)).toHaveLength(0);
  });

  test("recover skips a runner it cannot bring back and adopts the others", async () => {
    const runner = makeRunner();
    await runner.provision(user);
    await runner.provision({ userId: "u2" });
    for (const c of fake.containers.values()) c.running = false;
    const u1 = [...fake.containers.values()].find((c) => c.name === "office-runner-u1");
    fake.onStart = (c) => (c.id === u1?.id ? { status: 403, message: "denied" } : undefined);
    const handles = await makeRunner().recover();
    expect(handles.map((h) => h.userId)).toEqual(["u2"]);
    expect(logged.some((l) => l.msg.includes("could not be recovered"))).toBe(true);
  });
});

describe("runner image", () => {
  test("a missing image that cannot be pulled is runner_image_missing", async () => {
    fake.images.clear();
    const err = await makeRunner({ pull: false })
      .provision(user)
      .catch((e) => e);
    expect(err).toBeInstanceOf(RunnerImageMissingError);
    expect(startFailureReason(err)).toBe(
      "runner_image_missing: the runner image runner:test is not on the Docker host and could not be pulled",
    );
  });

  test("an idle runner is recreated from a rebuilt image on its next use, HOME kept", async () => {
    const runner = makeRunner();
    const old = (await runner.provision(user)).containerId;
    await runner.containers.recreate(user.userId, [AREA_MOUNT]);
    fake.imageIds.set(IMAGE, "sha256:rebuilt");
    const handle = await runner.provision(user);
    expect(handle.containerId).not.toBe(old);
    const c = only();
    expect(c.imageId).toBe("sha256:rebuilt");
    expect(homeMount(c.body)?.Source).toBe("office-home-u1");
    expect((c.body.HostConfig as { Mounts: unknown[] }).Mounts).toContainEqual(AREA_MOUNT);
    expect(logged.map((l) => l.obj.reason)).toEqual(["the runner image changed"]);
  });

  test("a runner with a live tmux session keeps its old image", async () => {
    const runner = makeRunner();
    releaseNewSession = () => {};
    await runner.exec(user, plan("a1", ["claude"]));
    const before = only().id;
    fake.imageIds.set(IMAGE, "sha256:rebuilt");
    const handle = await makeRunner().provision(user);
    expect(handle.containerId).toBe(before);
    expect(logged).toHaveLength(0);
  });

  test("a runner with a piped process running keeps its old image", async () => {
    const runner = makeRunner();
    const proc = await runner.spawnPiped(user, plan("check", ["claude", "auth", "status"]));
    const before = only().id;
    fake.imageIds.set(IMAGE, "sha256:rebuilt");
    const other = await runner.provision(user);
    expect(other.containerId).toBe(before);
    await proc.write("x");
    await proc.exited;
  });

  test("an unclear tmux answer counts as busy", () => {
    expect(strictSessions({ code: 0, stdout: "a\nb\n", stderr: "" })).toEqual(["a", "b"]);
    expect(strictSessions({ code: 1, stdout: "", stderr: "no server running on x" })).toEqual([]);
    expect(strictSessions({ code: 1, stdout: "", stderr: "error connecting to x" })).toEqual([]);
    expect(strictSessions({ code: 1, stdout: "", stderr: "permission denied" })).toBeNull();
    expect(strictSessions(null)).toBeNull();
  });
});

describe("a session being created counts as busy", () => {
  test("a mount change during tmux new-session refuses instead of killing it", async () => {
    const runner = makeRunner();
    await runner.provision(user);
    const creating = runner.exec(user, plan("a1", ["claude"]));
    await newSessionSeen;
    const repo = { floorId: "f1", repoId: "r1", workdir: `${AREA}/_clones/repo` };
    const err = await runner.mountProject(user, repo).catch((e) => e);
    expect(err).toBeInstanceOf(RunnerBusyError);
    expect((err as RunnerBusyError).sessions).toEqual(["agent-a1"]);
    releaseNewSession?.();
    await creating;
    expect(sessions.has("agent-a1")).toBe(true);
  });
});

test("start failure kinds", () => {
  expect(classifyStartFailure(new DockerApiError(500, RWLAYER))).toBe("broken");
  expect(classifyStartFailure(new DockerApiError(500, "No such image: x"))).toBe("broken");
  expect(classifyStartFailure(new DockerApiError(500, "something else"))).toBe("retry");
  expect(classifyStartFailure(new DockerApiError(404, "No such container"))).toBe("gone");
  expect(classifyStartFailure(new DockerApiError(409, "paused"))).toBe("other");
  expect(classifyStartFailure(new Error("socket closed"))).toBe("other");
});
