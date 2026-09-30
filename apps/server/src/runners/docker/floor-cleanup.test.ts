/**
 * A deleted floor's human areas are removed as the runner uid (#150), against
 * the fake Engine: by an exec in the human's running runner when it has the
 * area mounted, else by a locked-down janitor container. The fake "runs" the
 * `rm` it is given, so the tests see what would be left.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, rm, stat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DockerRunner } from "./docker-runner.ts";
import { EngineClient } from "./engine.ts";
import { JANITOR_ROLE } from "./floor-cleanup.ts";
import { FakeEngine } from "./testing/fake-engine.ts";

const IMAGE = "runner:test";
const EMPTY = ["-xdev", "-mindepth", "1", "-delete"];

let fake: FakeEngine;
let root: string;

/** What `find <paths> -xdev -mindepth 1 -delete` would do: empty each dir. */
async function emptyAll(args: readonly string[]): Promise<void> {
  for (const p of args.slice(0, args.length - EMPTY.length)) {
    for (const entry of await readdir(p)) await rm(join(p, entry), { recursive: true });
  }
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "rg150-cleanup-"));
  fake = await FakeEngine.start();
  fake.images.add(IMAGE);
  fake.onExec = async (exec) => {
    if (exec.cmd[0] === "find") await emptyAll(exec.cmd.slice(1));
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
    labels: { "regulus-test": "1" },
  });
}

const exists = (p: string) =>
  stat(p).then(
    () => true,
    () => false,
  );
const creates = () => fake.calls("POST", "/containers/create").map((c) => JSON.parse(c.body));
const janitors = () =>
  creates().filter((b) => b.Labels?.["org.regulus.office.role"] === JANITOR_ROLE);

async function area(floor: string, rid: string): Promise<string> {
  const dir = join(root, floor, rid);
  await mkdir(join(dir, "_clones", "repo", "nested"), { recursive: true });
  return dir;
}

describe("removeFloorAreas", () => {
  test("an area mounted in its human's running runner is removed there, no janitor", async () => {
    const runner = dockerRunner();
    const doomed = await area("doomed", "u1");
    const kept = await area("kept", "u1");
    await runner.mountProject({ userId: "u1" }, { floorId: "d", repoId: "r", workdir: doomed });
    await runner.mountProject({ userId: "u1" }, { floorId: "k", repoId: "r", workdir: kept });
    await runner.removeFloorAreas("doomed");
    const finds = [...fake.execs.values()].filter((e) => e.cmd[0] === "find");
    expect(finds.map((e) => e.cmd)).toEqual([["find", doomed, ...EMPTY]]);
    expect(await readdir(doomed)).toEqual([]);
    expect(await exists(join(kept, "_clones", "repo", "nested"))).toBe(true);
    expect(janitors()).toEqual([]);
  });

  test("areas without a running runner go to a locked-down janitor, removed afterwards", async () => {
    const runner = dockerRunner();
    const a = await area("doomed", "u1");
    const b = await area("doomed", "u2");
    const kept = await area("kept", "u1");
    let ran: string[] = [];
    fake.onWait = async (c) => {
      ran = c.body.Cmd as string[];
      await emptyAll(ran);
      return 0;
    };
    await runner.removeFloorAreas("doomed");
    expect(janitors()).toHaveLength(1);
    const body = janitors()[0];
    expect(body).toMatchObject({
      Image: IMAGE,
      User: "1001:1001",
      Entrypoint: ["find"],
      Cmd: [a, b, ...EMPTY],
      NetworkDisabled: true,
      Labels: { "org.regulus.office.role": JANITOR_ROLE, "org.regulus.office.prefix": "office" },
      HostConfig: {
        Mounts: [{ Type: "bind", Source: join(root, "doomed"), Target: join(root, "doomed") }],
        NetworkMode: "none",
        CapDrop: ["ALL"],
        SecurityOpt: ["no-new-privileges"],
        ReadonlyRootfs: true,
      },
    });
    expect(await readdir(a)).toEqual([]);
    expect(await readdir(b)).toEqual([]);
    expect(await exists(kept)).toBe(true);
    // Started, waited for and removed.
    expect(fake.calls("POST", /\/start$/)).toHaveLength(1);
    expect(fake.calls("DELETE", /^\/containers\//)).toHaveLength(1);
    expect(fake.containers.size).toBe(0);
  });

  test("a janitor that could not remove everything is still removed; the office decides", async () => {
    const runner = dockerRunner();
    await area("doomed", "u1");
    fake.onWait = () => 1;
    await runner.removeFloorAreas("doomed");
    expect(fake.containers.size).toBe(0);
  });

  test("the floor dir is checked before anything reaches Docker", async () => {
    const runner = dockerRunner();
    const elsewhere = join(root, "elsewhere");
    await mkdir(join(elsewhere, "u1"), { recursive: true });
    await symlink(elsewhere, join(root, "evil"));
    await expect(runner.removeFloorAreas("evil")).rejects.toThrow("not a directory");
    for (const slug of ["..", "a/b", "/etc", "X"]) {
      await expect(runner.removeFloorAreas(slug)).rejects.toThrow("invalid floor slug");
    }
    // Nothing to do for a floor without areas.
    await runner.removeFloorAreas("absent");
    expect(fake.requests).toEqual([]);
    expect(await exists(join(elsewhere, "u1"))).toBe(true);
  });
});
