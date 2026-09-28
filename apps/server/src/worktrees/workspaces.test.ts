/** GitWorktreeWorkspaces against local bare repos over file:// (no network). */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { agents } from "../db/schema/index.ts";
import { basicAuthHeader } from "../github/git.ts";
import { agentGitEnv, branchSlug, parsePorcelain } from "./git-ops.ts";
import {
  commitIn,
  FAKE_PAT,
  filesContaining,
  git,
  pushToRemote,
  setupFloor,
} from "./test-helpers.ts";
import { WorkspaceError } from "./types.ts";

let root: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "office-worktrees-"));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

const exists = (p: string) =>
  stat(p).then(
    () => true,
    () => false,
  );

async function errorOf(p: Promise<unknown>): Promise<WorkspaceError> {
  try {
    await p;
  } catch (err) {
    if (err instanceof WorkspaceError) return err;
    throw err;
  }
  throw new Error("expected a WorkspaceError");
}

describe("helpers", () => {
  test("branch slugs are ref-safe", () => {
    expect(branchSlug("Fix #12: Login!")).toBe("fix-12-login");
    expect(branchSlug("../../x.lock")).toBe("x-lock");
    expect(branchSlug("  ")).toBe("agent");
    expect(branchSlug("a".repeat(80))).toHaveLength(48);
  });

  test("porcelain -z parsing handles renames", () => {
    expect(parsePorcelain(" M a.ts\0?? new file.txt\0R  b.ts\0old-b.ts\0")).toEqual([
      "a.ts",
      "new file.txt",
      "b.ts",
    ]);
  });

  test("agent git env carries safe.directory only", () => {
    expect(Object.values(agentGitEnv("/w/f/a", "/p/f/r"))).toContain("/w/f/a");
  });
});

describe("prepare", () => {
  test("fetches first and bases the worktree on origin/<default>, not the stale local branch", async () => {
    const f = await setupFloor(root);
    const local = await git(["-C", f.repo.workdir, "rev-parse", "trunk"]);
    const upstream = await pushToRemote(f.bare, "trunk", "news.md", "upstream moved on");
    expect(upstream).not.toBe(local);

    const agentId = f.addAgent("agent-a1");
    const ws = await f.worktrees.workspaces.prepare({
      agentId,
      floorId: f.floorId,
      repoId: f.repo.repoId,
      slug: "Fix Login",
      ownerUserId: f.owner.id,
    });
    expect(ws.branch).toBe("office/fix-login");
    expect(ws.workdir).toBe(join(f.areaOf(), agentId));
    const head = await git([
      "-c",
      `safe.directory=${ws.workdir}`,
      "-C",
      ws.workdir,
      "rev-parse",
      "HEAD",
    ]);
    expect(head).toBe(upstream);
    expect(await exists(join(ws.workdir, "news.md"))).toBe(true);
    const current = await git([
      "-c",
      `safe.directory=${ws.workdir}`,
      "-C",
      ws.workdir,
      "branch",
      "--show-current",
    ]);
    expect(current).toBe("office/fix-login");

    // Runner access for the owner's own clone and the worktree, never the mirror (#114).
    const clone = f.cloneOf();
    expect(f.mounts).toEqual([clone, ws.workdir]);
    expect(await git(["-C", clone, "config", "remote.origin.url"])).toBe(f.repo.remoteUrl);
    expect(await git(["-C", clone, "config", "core.sharedRepository"])).toBe("1"); // git stores --shared=group as 1;
    expect(await git(["-C", f.repo.workdir, "worktree", "list"])).not.toContain(ws.workdir);
    // Other humans' runners may traverse the floor dir; the area is closed to "other".
    expect((await stat(f.areaOf())).mode & 0o007).toBe(0);
    // Recorded on the agent.
    const row = f.db.select().from(agents).where(eq(agents.id, agentId)).get();
    expect(row?.worktreeBranch).toBe("office/fix-login");
    expect(row?.workdir).toBe(ws.workdir);

    // The PAT never reaches argv or anything on disk (clone .git or worktree).
    const header = basicAuthHeader(FAKE_PAT).split(" ").pop() ?? "";
    expect(f.gitCalls.flat().join(" ")).not.toContain(FAKE_PAT);
    for (const needle of [FAKE_PAT, header]) {
      expect(await filesContaining(join(f.repo.workdir, ".git"), needle)).toEqual([]);
      expect(await filesContaining(join(clone, ".git"), needle)).toEqual([]);
      expect(await filesContaining(ws.workdir, needle)).toEqual([]);
    }
    // Office git in a repo never runs its hooks (config reads use --file, outside any repo).
    const inRepo = f.gitCalls.filter((args) => args[0] !== "config");
    expect(inRepo.length).toBeGreaterThan(0);
    expect(inRepo.every((args) => args.includes("core.hooksPath=/dev/null"))).toBe(true);
  });

  test("slugs are made unique against local and remote branches; prepare is idempotent", async () => {
    const f = await setupFloor(root);
    await git(["-C", f.bare, "branch", "office/task", "trunk"]); // pushed by someone earlier
    const input = (agentId: string) => ({
      agentId,
      floorId: f.floorId,
      repoId: f.repo.repoId,
      slug: "task",
      ownerUserId: f.owner.id,
    });
    const a = await f.worktrees.workspaces.prepare(input(f.addAgent("a1")));
    const b = await f.worktrees.workspaces.prepare(input(f.addAgent("a2")));
    expect(a.branch).toBe("office/task-2");
    expect(b.branch).toBe("office/task-3");
    expect(await f.worktrees.workspaces.prepare(input("a1"))).toEqual(a);
  });

  test("refuses a human's clone whose config their agent tampered with", async () => {
    const f = await setupFloor(root);
    const input = (agentId: string) => ({
      agentId,
      floorId: f.floorId,
      repoId: f.repo.repoId,
      slug: "x",
      ownerUserId: f.owner.id,
    });
    await f.worktrees.workspaces.prepare(input(f.addAgent("a1")));
    await git(["-C", f.cloneOf(), "config", "core.fsmonitor", "touch /tmp/pwned"]);
    const err = await errorOf(f.worktrees.workspaces.prepare(input(f.addAgent("a2"))));
    expect(err.message).toContain("core.fsmonitor");
  });

  test("refuses a mirror whose config was tampered with (before #114 runners could write it)", async () => {
    const f = await setupFloor(root);
    await git([
      "-C",
      f.repo.workdir,
      "config",
      "url.https://evil.example/.insteadOf",
      f.repo.remoteUrl,
    ]);
    const err = await errorOf(
      f.worktrees.workspaces.prepare({
        agentId: f.addAgent("a1"),
        floorId: f.floorId,
        repoId: f.repo.repoId,
        slug: "x",
        ownerUserId: f.owner.id,
      }),
    );
    expect(err.message).toContain("insteadof");
  });

  test("hooks planted in the mirror or a human's clone do not run in office git", async () => {
    const f = await setupFloor(root);
    const marker = join(root, `hook-ran-${Date.now()}`);
    const plant = async (repo: string) => {
      await mkdir(join(repo, ".git", "hooks"), { recursive: true });
      for (const name of ["post-checkout", "reference-transaction", "post-index-change"]) {
        const hook = join(repo, ".git", "hooks", name);
        await writeFile(hook, `#!/bin/sh\ntouch ${marker}\n`, { mode: 0o755 });
      }
    };
    const input = (agentId: string) => ({
      agentId,
      floorId: f.floorId,
      repoId: f.repo.repoId,
      slug: "hooks",
      ownerUserId: f.owner.id,
    });
    await plant(f.repo.workdir);
    await f.worktrees.workspaces.prepare(input(f.addAgent("a1")));
    await plant(f.cloneOf());
    await f.worktrees.workspaces.prepare(input(f.addAgent("a2")));
    expect(await exists(marker)).toBe(false);
  });

  test("each human gets their own clone; branch names stay unique across them", async () => {
    const f = await setupFloor(root);
    const bob = f.addUser("Bob", "member");
    const input = (agentId: string, ownerUserId: string) => ({
      agentId,
      floorId: f.floorId,
      repoId: f.repo.repoId,
      slug: "same task",
      ownerUserId,
    });
    const a = await f.worktrees.workspaces.prepare(input(f.addAgent("a1"), f.owner.id));
    const b = await f.worktrees.workspaces.prepare(
      input(f.addAgent("b1", { ownerUserId: bob.id }), bob.id),
    );
    expect(f.cloneOf(bob.id)).not.toBe(f.cloneOf());
    expect(b.workdir).toBe(join(f.areaOf(bob.id), "b1"));
    expect([a.branch, b.branch]).toEqual(["office/same-task", "office/same-task-2"]);
    // Neither clone knows the other's worktrees or branches.
    expect(await git(["-C", f.cloneOf(), "worktree", "list"])).not.toContain(b.workdir);
    expect(await git(["-C", f.cloneOf(bob.id), "branch", "--list", a.branch])).toBe("");
    const ws = f.worktrees.workspaces;
    expect(ws.cloneFor({ ownerUserId: bob.id, repoId: f.repo.repoId, workdir: b.workdir })).toEqual(
      { clone: f.cloneOf(bob.id), legacy: false },
    );
    // A worktree in someone else's area, or a pre-#114 one, is never treated as Bob's clone.
    for (const workdir of [a.workdir, join(f.worktreesDir, "wt-floor", "b1"), f.repo.workdir]) {
      expect(ws.cloneFor({ ownerUserId: bob.id, repoId: f.repo.repoId, workdir })).toEqual({
        clone: f.repo.workdir,
        legacy: true,
      });
    }
  });

  test("prepareClone (no worktree) gives the owner's clone on the default branch", async () => {
    const f = await setupFloor(root);
    const agentId = f.addAgent("a1");
    const ws = await f.worktrees.workspaces.prepareClone({
      agentId,
      floorId: f.floorId,
      repoId: f.repo.repoId,
      slug: "x",
      ownerUserId: f.owner.id,
    });
    expect(ws).toEqual({ workdir: f.cloneOf(), branch: "trunk" });
    expect(f.mounts).toEqual([f.cloneOf()]);
    f.db.update(agents).set({ workdir: ws.workdir, worktreeBranch: ws.branch }).run();
    // Send-home never removes the human's clone.
    await f.worktrees.workspaces.release({ agentId, keepBranch: false });
    expect(await exists(join(f.cloneOf(), ".git"))).toBe(true);
  });

  test("unknown or foreign repos are refused", async () => {
    const f = await setupFloor(root);
    const err = await errorOf(
      f.worktrees.workspaces.prepare({
        agentId: "a1",
        floorId: "other-floor",
        repoId: f.repo.repoId,
        slug: "x",
        ownerUserId: f.owner.id,
      }),
    );
    expect(err.code).toBe("repo_not_found");
  });
});

describe("release", () => {
  async function prepared(slug: string) {
    const f = await setupFloor(root);
    const agentId = f.addAgent(`agent-${slug}`);
    const ws = await f.worktrees.workspaces.prepare({
      agentId,
      floorId: f.floorId,
      repoId: f.repo.repoId,
      slug,
      ownerUserId: f.owner.id,
    });
    await commitIn(ws.workdir, "work.md", "agent work");
    await git(["-C", f.cloneOf(), "push", "--quiet", "origin", ws.branch]);
    return { f, agentId, ws };
  }

  const remoteHas = async (bare: string, branch: string) =>
    (await git(["-C", bare, "branch", "--list", branch])).length > 0;

  test("keepBranch removes the worktree but keeps the branch locally and remotely", async () => {
    const { f, agentId, ws } = await prepared("keep");
    await f.worktrees.workspaces.release({ agentId, keepBranch: true });
    expect(await exists(ws.workdir)).toBe(false);
    expect(await git(["-C", f.cloneOf(), "branch", "--list", ws.branch])).toContain(ws.branch);
    expect(await remoteHas(f.bare, ws.branch)).toBe(true);
    expect(await git(["-C", f.cloneOf(), "worktree", "list"])).not.toContain(ws.workdir);
    const row = f.db.select().from(agents).where(eq(agents.id, agentId)).get();
    expect(row?.worktreeBranch).toBe(ws.branch);
  });

  test("delete removes the branch locally and on the remote, even with uncommitted files", async () => {
    const { f, agentId, ws } = await prepared("drop");
    await writeFile(join(ws.workdir, "scratch.txt"), "unsaved\n");
    await f.worktrees.workspaces.release({ agentId, keepBranch: false });
    expect(await exists(ws.workdir)).toBe(false);
    expect(await git(["-C", f.cloneOf(), "branch", "--list", ws.branch])).toBe("");
    expect(await remoteHas(f.bare, ws.branch)).toBe(false);
    const row = f.db.select().from(agents).where(eq(agents.id, agentId)).get();
    expect(row?.worktreeBranch).toBeNull();
    // Never pushed: deleting only the local branch works too.
    const other = f.addAgent("agent-local");
    const w2 = await f.worktrees.workspaces.prepare({
      agentId: other,
      floorId: f.floorId,
      repoId: f.repo.repoId,
      slug: "local",
      ownerUserId: f.owner.id,
    });
    await f.worktrees.workspaces.release({ agentId: other, keepBranch: false });
    expect(await git(["-C", f.cloneOf(), "branch", "--list", w2.branch])).toBe("");
  });

  test("unknown agents are a no-op", async () => {
    const f = await setupFloor(root);
    await f.worktrees.workspaces.release({ agentId: "ghost", keepBranch: false });
  });
});

describe("prune", () => {
  test("removes worktrees of agents that no longer exist and prunes git's records", async () => {
    const f = await setupFloor(root);
    const keep = f.addAgent("live");
    const gone = f.addAgent("gone");
    const input = (agentId: string) => ({
      agentId,
      floorId: f.floorId,
      repoId: f.repo.repoId,
      slug: agentId,
      ownerUserId: f.owner.id,
    });
    const live = await f.worktrees.workspaces.prepare(input(keep));
    const dead = await f.worktrees.workspaces.prepare(input(gone));
    f.db.delete(agents).where(eq(agents.id, gone)).run();
    // Leftover directories git never knew about, in the area and (pre-#114) in the floor dir.
    const stray = join(f.areaOf(), "stray");
    const oldStray = join(f.worktreesDir, "wt-floor", "old-agent");
    await mkdir(stray, { recursive: true });
    await mkdir(oldStray, { recursive: true });
    // Prepared by this process, row not inserted yet (the manager inserts it after prepare).
    const pending = await f.worktrees.workspaces.prepare(input("pending"));

    const first = await f.worktrees.prune();
    expect(first.removed.sort()).toEqual([oldStray, stray].sort());
    expect(await exists(pending.workdir)).toBe(true);
    expect(await exists(dead.workdir)).toBe(true);

    const res = await f.restart().prune();
    expect(res.removed.sort()).toEqual([dead.workdir, pending.workdir].sort());
    expect(res.failed).toEqual([]);
    expect(res.repos).toBe(2); // the human's clone and the mirror
    expect(await exists(live.workdir)).toBe(true);
    expect(await exists(join(f.cloneOf(), ".git"))).toBe(true);
    const list = await git(["-C", f.cloneOf(), "worktree", "list"]);
    expect(list).toContain(live.workdir);
    expect(list).not.toContain(dead.workdir);
    // The orphan's branch is kept: it may hold unpushed work.
    expect(await git(["-C", f.cloneOf(), "branch", "--list", dead.branch])).toContain(dead.branch);
    expect(await readFile(join(live.workdir, "README.md"), "utf8")).toContain("hello");
  });
});
