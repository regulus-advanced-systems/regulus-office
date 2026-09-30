/**
 * A deleted floor (#150) leaves mounts of its areas in runner containers.
 * Docker cannot recreate a container with a mount whose source is gone, so
 * an idle runner drops them at the next reconcile; a busy one keeps them
 * (harmless: an empty, deleted dir) and is never refused because of them.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SecretEnv } from "@regulus/agent-adapters";
import { DockerRunner } from "./docker-runner.ts";
import { EngineClient } from "./engine.ts";
import { areaGone } from "./mounts.ts";
import { FakeEngine } from "./testing/fake-engine.ts";

const IMAGE = "runner:test";
const user = { userId: "u1" };

let fake: FakeEngine;
let root: string;
let sessions: Set<string>;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "rg150-docker-"));
  fake = await FakeEngine.start();
  fake.images.add(IMAGE);
  sessions = new Set();
  fake.onExec = async (exec, io) => {
    const [bin, ...args] = exec.cmd;
    if (bin !== "tmux") return 0;
    if (args[2] === "new-session") sessions.add(args[args.indexOf("-s") + 1] ?? "");
    if (args[2] === "list-sessions") io.stdout([...sessions].map((s) => `${s}\n`).join(""));
    return 0;
  };
});

afterEach(async () => {
  await fake.stop();
  await rm(root, { recursive: true, force: true });
});

function dockerRunner(): DockerRunner {
  return new DockerRunner({
    engine: new EngineClient(fake.dockerHost),
    image: IMAGE,
    prefix: "office",
    user: "1001:1001",
    home: "/home/runner",
    floorRoots: [root],
  });
}

const targets = () =>
  (
    JSON.parse(fake.calls("POST", "/containers/create").at(-1)?.body ?? "{}").HostConfig.Mounts as {
      Target: string;
    }[]
  ).map((m) => m.Target);

describe("areaGone", () => {
  test("only when the root is visible and the area is not", async () => {
    await mkdir(join(root, "kept", "u1"), { recursive: true });
    expect(areaGone(join(root, "kept", "u1"), [root])).toBe(false);
    expect(areaGone(join(root, "deleted", "u1"), [root])).toBe(true);
    // Paths of another host: the office cannot judge, so the mount stays.
    expect(areaGone("/nowhere-rg150/f/u1", ["/nowhere-rg150"])).toBe(false);
  });
});

describe("mounts of a deleted floor's areas", () => {
  test("an idle runner drops them on reconcile and keeps the other floors", async () => {
    const kept = join(root, "kept", "u1");
    const deleted = join(root, "deleted", "u1");
    const runner = dockerRunner();
    await runner.mountProject(user, { floorId: "k", repoId: "r", workdir: `${kept}/_clones/r` });
    await runner.mountProject(user, { floorId: "d", repoId: "r", workdir: `${deleted}/_clones/r` });
    expect(targets()).toEqual(["/home/runner", kept, deleted]);

    await rm(join(root, "deleted"), { recursive: true });
    expect(await runner.reconcileMounts(user)).toBe(true);
    expect(targets()).toEqual(["/home/runner", kept]);
  });

  test("a busy runner keeps them and still gets new agents", async () => {
    const kept = join(root, "kept", "u1");
    const deleted = join(root, "deleted", "u1");
    const runner = dockerRunner();
    await runner.mountProject(user, { floorId: "k", repoId: "r", workdir: `${kept}/_clones/r` });
    await runner.mountProject(user, { floorId: "d", repoId: "r", workdir: `${deleted}/_clones/r` });
    await runner.exec(user, {
      agentId: "a1",
      provider: "custom",
      argv: ["claude"],
      env: SecretEnv.of({}),
      cwd: `${kept}/_clones/r`,
      tmuxSession: "agent-a1",
      files: [],
    });
    await rm(join(root, "deleted"), { recursive: true });
    const creates = fake.calls("POST", "/containers/create").length;
    expect(await runner.reconcileMounts(user)).toBe(true);
    await runner.mountProject(user, { floorId: "k", repoId: "r", workdir: `${kept}/a2` });
    expect(fake.calls("POST", "/containers/create")).toHaveLength(creates);
  });
});
