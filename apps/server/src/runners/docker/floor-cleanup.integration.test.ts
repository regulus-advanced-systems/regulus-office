/**
 * Integration (#150): deleting a floor in docker mode removes what agents
 * wrote there as the runner uid, including directories without group write
 * that the office itself could not empty. The runner runs as 4242:4242 here,
 * never the test's own uid, so the office really cannot remove those files.
 * One human's area is mounted in their running runner (emptied by an exec
 * there); the other's runner is gone (emptied by a janitor container). The
 * other floor is untouched.
 *
 * Opt-in like docker-runner.integration.test.ts: REGULUS_DOCKER_TESTS=1, and
 * REGULUS_DOCKER_RUNNER_HOST to go through the socket proxy (CI).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLogger } from "../../logging.ts";
import { floorDirRemover } from "../../worktrees/floor-dirs.ts";
import { LABEL_PREFIX } from "./containers.ts";
import { DockerRunner } from "./docker-runner.ts";
import { EngineClient } from "./engine.ts";
import { tar } from "./testing/tar.ts";

const engine = new EngineClient();
const runnerEngine = new EngineClient(process.env.REGULUS_DOCKER_RUNNER_HOST ?? undefined);
const requested = process.env.REGULUS_DOCKER_TESTS === "1";
const reachable = requested && (await engine.ping());
if (requested && !reachable) throw new Error("REGULUS_DOCKER_TESTS=1 but Docker is not reachable");
const enabled = requested && reachable;
const TEST_LABEL = { "regulus-test": "1" };
const suffix = Math.random().toString(36).slice(2, 8);
const IMAGE = `regulus-test-cleanup:${suffix}`;
const PREFIX = `rgclean-${suffix}`;
const RUNNER_UID = 4242;
const isRoot = process.getuid?.() === 0;

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

/**
 * Everything with this run's prefix. Retried for a while: the delete's
 * background mount reconcile may be recreating a runner at the same time.
 */
async function cleanup(): Promise<void> {
  const filters = JSON.stringify({ label: [`${LABEL_PREFIX}=${PREFIX}`] });
  const deadline = Date.now() + 30_000;
  for (;;) {
    const containers = await engine.json<{ Id: string }[]>("GET", "/containers/json", {
      query: { all: true, filters },
    });
    for (const c of containers) {
      await engine
        .call("DELETE", `/containers/${c.Id}`, { query: { force: true } })
        .catch(() => {});
    }
    const { Volumes } = await engine.json<{ Volumes: { Name: string }[] | null }>(
      "GET",
      "/volumes",
      { query: { filters: JSON.stringify({ label: ["regulus-test=1"] }) } },
    );
    const mine = (Volumes ?? []).filter((v) => v.Name.startsWith(PREFIX));
    let left = containers.length;
    for (const v of mine) {
      await engine.call("DELETE", `/volumes/${v.Name}`).catch(() => {
        left += 1;
      });
    }
    if ((left === 0 && mine.length === 0) || Date.now() > deadline) break;
    await Bun.sleep(500);
  }
  await engine.request("DELETE", `/images/${IMAGE}`, { query: { force: true } });
}

describe.skipIf(!enabled)("deleting a floor removes runner-owned files (real Docker)", () => {
  let root: string;
  let runner: DockerRunner;
  const worktrees = () => join(root, "worktrees");
  const clone = (floor: string, rid: string) => join(worktrees(), floor, rid, "_clones", "repo");

  /** The office's dirs down to the clone, open to the runner uid (as group 1001 is in Compose). */
  async function openClone(floor: string, rid: string): Promise<string> {
    const dir = clone(floor, rid);
    await mkdir(dir, { recursive: true });
    for (let d = dir; d.startsWith(join(worktrees(), floor, rid)); d = join(d, "..")) {
      await chmod(d, 0o777);
    }
    return dir;
  }

  /** As the runner uid, with umask 022: a dir and file the office cannot remove. */
  async function writeLocked(userId: string, dir: string): Promise<void> {
    const { containerId } = await runner.provision({ userId });
    const script = 'umask 022; mkdir -p "$1/locked/deep" && echo work > "$1/locked/deep/f"';
    const res = await runnerEngine.exec(containerId as string, {
      cmd: ["sh", "-c", script, "sh", dir],
    });
    expect(res).toMatchObject({ code: 0 });
    expect((await stat(join(dir, "locked", "deep", "f"))).uid).toBe(RUNNER_UID);
  }

  beforeAll(async () => {
    await buildImage();
    root = await mkdtemp(join(tmpdir(), "rg150-docker-"));
    await chmod(root, 0o755);
    runner = new DockerRunner({
      engine: runnerEngine,
      image: IMAGE,
      prefix: PREFIX,
      user: `${RUNNER_UID}:${RUNNER_UID}`,
      home: "/home/runner",
      labels: TEST_LABEL,
      pull: false,
      floorRoots: [worktrees()],
    });
  }, 600_000);

  afterAll(async () => {
    // What is left belongs to the runner uid: the same cleanup removes it.
    await runner?.removeFloorAreas("kept").catch(() => {});
    await cleanup();
    if (root) await rm(root, { recursive: true, force: true }).catch(() => {});
  }, 120_000);

  test("an exec in the running runner and a janitor empty the areas; the office removes the rest", async () => {
    const mine = await openClone("doomed", "u1");
    const kept = await openClone("kept", "u1");
    const gone = await openClone("doomed", "u2");
    await runner.mountProject({ userId: "u1" }, { floorId: "d", repoId: "r", workdir: mine });
    await runner.mountProject({ userId: "u1" }, { floorId: "k", repoId: "r", workdir: kept });
    await runner.mountProject({ userId: "u2" }, { floorId: "d", repoId: "r", workdir: gone });
    for (const [userId, dir] of [
      ["u1", mine],
      ["u1", kept],
      ["u2", gone],
    ] as const) {
      await writeLocked(userId, dir);
    }
    // u2's runner is gone: its area can only be emptied by a janitor.
    await runner.deprovision({ userId: "u2" });
    if (!isRoot) {
      await expect(unlink(join(mine, "locked", "deep", "f"))).rejects.toThrow();
    }
    const mirror = join(root, "projects", "doomed", "repo");
    await mkdir(mirror, { recursive: true });

    const remover = floorDirRemover({
      projectsDir: join(root, "projects"),
      worktreesDir: worktrees(),
      runner,
      logger: createLogger({ level: "silent" }),
    });
    expect(await remover.removeFloorDirs("doomed")).toEqual([
      join(root, "projects", "doomed"),
      join(worktrees(), "doomed"),
    ]);
    expect(await stat(join(worktrees(), "doomed")).catch(() => null)).toBeNull();
    expect(await stat(join(root, "projects", "doomed")).catch(() => null)).toBeNull();
    expect(await readFile(join(kept, "locked", "deep", "f"), "utf8")).toBe("work\n");
    // The idle runner drops its mount of the deleted area (background reconcile).
    const doomedArea = join(worktrees(), "doomed", "u1");
    const deadline = Date.now() + 30_000;
    let targets: string[] = [];
    for (;;) {
      const c = await runner.containers.lookup("u1").catch(() => null);
      targets = c?.floorMounts.map((m) => m.Target) ?? [];
      if ((c?.running && !targets.includes(doomedArea)) || Date.now() > deadline) break;
      await Bun.sleep(200);
    }
    expect(targets).toEqual([join(worktrees(), "kept", "u1")]);
    // No janitor is left behind.
    const janitors = await engine.json<unknown[]>("GET", "/containers/json", {
      query: {
        all: true,
        filters: JSON.stringify({
          label: [`${LABEL_PREFIX}=${PREFIX}`, "org.regulus.office.role=janitor"],
        }),
      },
    });
    expect(janitors).toEqual([]);
  }, 300_000);
});
