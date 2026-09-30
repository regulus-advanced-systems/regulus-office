/**
 * The changes window against a real agent worktree (#31/#114 layout), with
 * every command run through the local runner's `spawnPiped` (the test
 * double of a human's runner): status, diffs, image reads, commit and
 * discard, concurrent-edit conflicts, the robot's index lock and symlinks.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SpawnPlan } from "@regulus/agent-adapters";
import type { ChangedFile, ChangesSnapshot } from "@regulus/protocol";
import { hasTmux, LocalTmuxRunner } from "../runners/testing/local-tmux-runner.ts";
import type { RunnerUser } from "../runners/types.ts";
import { git, setupFloor } from "../worktrees/test-helpers.ts";
import { ChangesHttpError } from "./paths.ts";
import { type AgentRow, ChangesService } from "./service.ts";

const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1,
  0, 0, 0, 1, 8, 6, 0, 0, 0, 0x1f, 0x15, 0xc4, 0x89,
]);
const PNG2 = new Uint8Array([...PNG, 0, 0, 0, 0]);

let root: string;
let runner: LocalTmuxRunner;
let calls: { user: RunnerUser; plan: SpawnPlan }[] = [];
let f: Awaited<ReturnType<typeof setupFloor>>;
let service: ChangesService;
let row: AgentRow;
let workdir: string;
let secretFile: string;

const identity = { name: "Olga", email: "olga@example.com" };

async function errorOf(p: Promise<unknown>): Promise<ChangesHttpError> {
  try {
    await p;
  } catch (err) {
    if (err instanceof ChangesHttpError) return err;
    throw err;
  }
  throw new Error("expected a ChangesHttpError");
}

const wt = (...args: string[]) => git(["-c", `safe.directory=${workdir}`, ...args], workdir);

async function snapshot(): Promise<ChangesSnapshot["files"]> {
  // A fresh look every time (the cache is for concurrent viewers).
  const look = await new ChangesService({
    db: f.db,
    runner: recording(),
    repos: fRepos(),
    clones: f.worktrees.workspaces,
    cacheMs: 0,
  }).look(row);
  return look.snapshot.files;
}

function fRepos() {
  return { getRepo: (id: string) => (id === f.repo.repoId ? f.repo : undefined) };
}

function recording() {
  return {
    spawnPiped: (user: RunnerUser, plan: SpawnPlan) => {
      calls.push({ user, plan });
      return runner.spawnPiped(user, plan);
    },
  };
}

const file = (files: ChangedFile[], path: string) => files.find((x) => x.path === path);

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "rg38-changes-"));
  runner = await LocalTmuxRunner.create();
  f = await setupFloor(root);
  // Upstream has an image before the robot starts.
  const up = await mkdtemp(join(root, "up-"));
  await git(["clone", "--quiet", "--branch", "trunk", f.bare, up]);
  await Bun.write(join(up, "logo.png"), PNG);
  await Bun.write(join(up, "gone.txt"), "to be deleted\n");
  await git(["add", "."], up);
  await git(["commit", "--quiet", "-m", "assets"], up);
  await git(["push", "--quiet", "origin", "trunk"], up);

  const agentId = f.addAgent("agent-c1");
  const ws = await f.worktrees.workspaces.prepare({
    agentId,
    floorId: f.floorId,
    repoId: f.repo.repoId,
    slug: "changes",
    ownerUserId: f.owner.id,
  });
  workdir = ws.workdir;
  service = new ChangesService({
    db: f.db,
    runner: recording(),
    repos: fRepos(),
    clones: f.worktrees.workspaces,
    cacheMs: 0,
  });
  row = service.agent(agentId) as AgentRow;
  secretFile = join(root, "credentials.json");
  await writeFile(secretFile, "SECRET-TOKEN\n");
});

afterAll(async () => {
  // Only `spawnPiped` is used, which needs no tmux; dispose kills the (never started) server.
  if (hasTmux()) await runner.dispose();
  else await rm(runner.dir, { recursive: true, force: true });
  await rm(root, { recursive: true, force: true });
});

describe("changes window on a real worktree", () => {
  test("a clean worktree has no changes; the base is the merge-base with origin/trunk", async () => {
    const look = await service.look(row);
    expect(look.snapshot.branch).toBe("office/changes");
    expect(look.snapshot.base.ref).toBe("origin/trunk");
    expect(look.snapshot.base.sha).toBe(look.snapshot.head);
    expect(look.snapshot.ahead).toBe(0);
    expect(look.snapshot.files).toEqual([]);
  });

  test("lists committed, staged, unstaged, untracked, binary and oddly named files", async () => {
    await Bun.write(join(workdir, "done.md"), "one\ntwo\n");
    await wt("add", "done.md");
    await wt("-c", "user.name=R", "-c", "user.email=r@x", "commit", "--quiet", "-m", "done");
    await Bun.write(join(workdir, "README.md"), "# hello\nmore\n");
    await Bun.write(join(workdir, "staged.txt"), "staged\n");
    await wt("add", "staged.txt");
    await Bun.write(join(workdir, "new file *.txt"), "a\nb\nc\n");
    await Bun.write(join(workdir, "logo.png"), PNG2);
    await Bun.write(join(workdir, "shot.png"), PNG);
    await rm(join(workdir, "gone.txt"));
    await symlink(secretFile, join(workdir, "leak.png"));

    const look = await service.look(row);
    const files = look.snapshot.files;
    expect(look.snapshot.ahead).toBe(1);
    expect(files.map((x) => x.path)).toEqual([
      "README.md",
      "done.md",
      "gone.txt",
      "leak.png",
      "logo.png",
      "new file *.txt",
      "shot.png",
      "staged.txt",
    ]);
    expect(file(files, "done.md")).toMatchObject({
      kind: "added",
      uncommitted: false,
      additions: 2,
    });
    expect(file(files, "README.md")).toMatchObject({ kind: "modified", uncommitted: true });
    expect(file(files, "README.md")?.sig).toMatch(/^\d+:\d+:/);
    expect(file(files, "gone.txt")).toMatchObject({
      kind: "deleted",
      uncommitted: true,
      sig: null,
    });
    expect(file(files, "logo.png")).toMatchObject({ binary: true, kind: "modified" });
    expect(file(files, "new file *.txt")).toMatchObject({ kind: "untracked", uncommitted: true });
    expect(file(files, "leak.png")).toMatchObject({ kind: "untracked", symlink: true });
    expect(file(files, "staged.txt")).toMatchObject({ kind: "added", uncommitted: true });

    // Every command ran as the robot's owner, for the robot, in its worktree, as argv.
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) {
      expect(c.user.userId).toBe(f.owner.id);
      expect(c.plan.agentId).toBe(row.id);
      expect(c.plan.cwd).toBe(workdir);
      expect(["git", "stat", "realpath", "head"]).toContain(c.plan.argv[0] ?? "");
    }
    const gitCalls = calls.filter((c) => c.plan.argv[0] === "git");
    expect(gitCalls.every((c) => c.plan.argv.includes("core.hooksPath=/dev/null"))).toBe(true);
    expect(gitCalls.every((c) => c.plan.env.reveal().GIT_OPTIONAL_LOCKS === "0")).toBe(true);
  });

  test("per-file diffs: text hunks, untracked files, images and symlinks", async () => {
    const readme = await service.fileDiff(row, "README.md");
    expect(readme.hunks[0]?.lines.map((l) => `${l.t}:${l.text}`)).toEqual([
      "ctx:# hello",
      "add:more",
    ]);
    const untracked = await service.fileDiff(row, "new file *.txt");
    expect(untracked.hunks[0]?.lines.filter((l) => l.t === "add")).toHaveLength(3);

    const logo = await service.fileDiff(row, "logo.png");
    expect(logo).toMatchObject({ binary: true, image: { base: true, work: true }, hunks: [] });
    const base = await service.image(row, "logo.png", "base");
    expect(base.type).toBe("image/png");
    expect(base.bytes).toEqual(PNG);
    const work = await service.image(row, "logo.png", "work");
    expect(work.bytes).toEqual(PNG2);
    const shot = await service.fileDiff(row, "shot.png");
    expect(shot.image).toEqual({ base: false, work: true });
    expect((await service.image(row, "shot.png", "work")).bytes).toEqual(PNG);

    // A symlink to the owner's secrets is never read, as a diff or as an image.
    const leak = await service.fileDiff(row, "leak.png");
    expect(leak.hunks).toEqual([]);
    expect(JSON.stringify(leak)).not.toContain("SECRET");
    expect((await errorOf(service.image(row, "leak.png", "work"))).code).toBe("not_image");

    expect((await errorOf(service.fileDiff(row, "../etc/passwd"))).code).toBe("invalid_path");
    expect((await errorOf(service.fileDiff(row, "/etc/passwd"))).code).toBe("invalid_path");
    expect((await errorOf(service.fileDiff(row, "not-changed.md"))).code).toBe("not_changed");
    expect((await errorOf(service.image(row, "README.md", "work"))).code).toBe("not_image");
  });

  test("a file swapped for a symlink after git listed it is refused before any bytes are read", async () => {
    // The robot racing the viewer: the cached look still says "regular file"; realpath catches it.
    const cached = new ChangesService({
      db: f.db,
      runner: recording(),
      repos: fRepos(),
      clones: f.worktrees.workspaces,
      cacheMs: 60_000,
    });
    const look = await cached.look(row);
    expect(look.byPath.get("shot.png")?.symlink).toBe(false);
    await rm(join(workdir, "shot.png"));
    await symlink(secretFile, join(workdir, "shot.png"));
    expect((await errorOf(cached.image(row, "shot.png", "work"))).code).toBe("invalid_path");
    await rm(join(workdir, "shot.png"));
    await Bun.write(join(workdir, "shot.png"), PNG);
  });

  test("discard: refused when the file changed since viewed, then reverts it", async () => {
    let files = await snapshot();
    const readme = file(files, "README.md");
    await Bun.write(join(workdir, "README.md"), "# hello\nrobot edited again\n");
    const stale = await errorOf(
      service.discard(row, { path: "README.md", sig: readme?.sig ?? null }),
    );
    expect(stale.code).toBe("changed_since_viewed");
    expect(stale.files).toEqual(["README.md"]);
    expect(await readFile(join(workdir, "README.md"), "utf8")).toContain("robot edited again");

    files = await snapshot();
    const fresh = file(files, "README.md");
    await service.discard(row, { path: "README.md", sig: fresh?.sig ?? null });
    expect(await readFile(join(workdir, "README.md"), "utf8")).toBe("# hello\n");

    const untracked = file(files, "new file *.txt");
    await service.discard(row, { path: "new file *.txt", sig: untracked?.sig ?? null });
    expect(await stat(join(workdir, "new file *.txt")).catch(() => null)).toBeNull();

    const staged = file(files, "staged.txt");
    await service.discard(row, { path: "staged.txt", sig: staged?.sig ?? null });
    expect(await stat(join(workdir, "staged.txt")).catch(() => null)).toBeNull();

    const gone = file(files, "gone.txt");
    await service.discard(row, { path: "gone.txt", sig: gone?.sig ?? null });
    expect(await readFile(join(workdir, "gone.txt"), "utf8")).toBe("to be deleted\n");

    // A committed-only file has nothing to discard.
    expect((await errorOf(service.discard(row, { path: "done.md", sig: null }))).code).toBe(
      "not_changed",
    );
  });

  test("commit: only the chosen files, refused on stale sigs, the robot's staging kept", async () => {
    await Bun.write(join(workdir, "a.txt"), "a\n");
    await Bun.write(join(workdir, "b.txt"), "b\n");
    await Bun.write(join(workdir, "robot-staged.txt"), "robot\n");
    await wt("add", "robot-staged.txt");
    let files = await snapshot();
    const sigOf = (p: string) => file(files, p)?.sig ?? null;

    await Bun.write(join(workdir, "b.txt"), "b changed by the robot\n");
    const stale = await errorOf(
      service.commit(
        row,
        {
          message: "Add a and b",
          files: [
            { path: "a.txt", sig: sigOf("a.txt") },
            { path: "b.txt", sig: sigOf("b.txt") },
          ],
        },
        identity,
      ),
    );
    expect(stale.code).toBe("changed_since_viewed");
    expect(stale.files).toEqual(["b.txt"]);

    files = await snapshot();
    const res = await service.commit(
      row,
      {
        message: "Add a and b",
        files: [
          { path: "a.txt", sig: sigOf("a.txt") },
          { path: "b.txt", sig: sigOf("b.txt") },
          { path: "logo.png", sig: sigOf("logo.png") },
        ],
      },
      identity,
    );
    expect(res.files).toBe(3);
    expect(await wt("rev-parse", "HEAD")).toBe(res.sha);
    expect(await wt("log", "-1", "--format=%s|%an|%ae")).toBe("Add a and b|Olga|olga@example.com");
    expect((await wt("show", "--name-only", "--format=", "HEAD")).split("\n").sort()).toEqual([
      "a.txt",
      "b.txt",
      "logo.png",
    ]);
    // The robot's own staged file is still staged, not committed.
    expect(await wt("diff", "--cached", "--name-only")).toBe("robot-staged.txt");
    const after = await snapshot();
    expect(file(after, "a.txt")).toMatchObject({ uncommitted: false, kind: "added" });
    expect(file(after, "robot-staged.txt")).toMatchObject({ uncommitted: true });
  });

  test("the robot's index lock: polling still works, writes report git_busy and leave the lock", async () => {
    const gitDir = await wt("rev-parse", "--git-dir");
    const lock = join(gitDir.startsWith("/") ? gitDir : join(workdir, gitDir), "index.lock");
    await writeFile(lock, "");
    try {
      const files = await snapshot();
      const staged = file(files, "robot-staged.txt");
      expect(staged).toBeDefined();
      const busy = await errorOf(
        service.commit(
          row,
          { message: "x", files: [{ path: "robot-staged.txt", sig: staged?.sig ?? null }] },
          identity,
        ),
      );
      expect(busy.code).toBe("git_busy");
      expect(busy.status).toBe(409);
      expect(await stat(lock).catch(() => null)).not.toBeNull();
    } finally {
      await rm(lock, { force: true });
    }
  });

  test("looks are shared between concurrent viewers", async () => {
    const shared = new ChangesService({
      db: f.db,
      runner: recording(),
      repos: fRepos(),
      clones: f.worktrees.workspaces,
    });
    calls = [];
    await Promise.all([shared.look(row), shared.look(row), shared.look(row)]);
    const statuses = calls.filter((c) => c.plan.argv.includes("status"));
    expect(statuses).toHaveLength(1);
  });
});
