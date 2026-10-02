/**
 * Worktrees shared by several henchmen of one human (a meeting's, #50): cut
 * from another start point, kept when one member goes home (whatever it asked
 * for its branch), removed by `releaseShared`, branch kept; the notes
 * directory is ignored through the clone's `info/exclude`.
 */
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { agents, meetings } from "../db/schema/index.ts";
import { excludeNotes } from "../meetings/workspace.ts";
import { git, setupOperation } from "./test-helpers.ts";

let root: string;
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "office-shared-worktree-"));
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

const exists = (p: string) =>
  stat(p).then(
    () => true,
    () => false,
  );

test("a shared worktree outlives its members and goes with its owner", async () => {
  const f = await setupOperation(root);
  // A feature branch on the remote (a pull request's head).
  const work = await mkdtemp(join(tmpdir(), "office-feature-"));
  await git(["clone", "--quiet", "--branch", "trunk", f.bare, work]);
  await git(["checkout", "--quiet", "-b", "feature"], work);
  await writeFile(join(work, "feature.txt"), "feature\n");
  await git(["add", "feature.txt"], work);
  await git(["commit", "--quiet", "-m", "feature"], work);
  await git(["push", "--quiet", "origin", "feature"], work);

  const ws = f.worktrees.workspaces;
  const meetingId = "meeting-1";
  const prepared = await ws.prepare({
    agentId: meetingId,
    operationId: f.operationId,
    repoId: f.repo.repoId,
    ownerUserId: f.owner.id,
    slug: "meeting-review",
    base: "origin/feature",
  });
  expect(prepared.workdir).toBe(join(f.areaOf(), meetingId));
  expect(prepared.branch).toBe("office/meeting-review");
  expect(await exists(join(prepared.workdir, "feature.txt"))).toBe(true);
  // Idempotent (a restart prepares it again).
  expect(
    await ws.prepare({
      agentId: meetingId,
      operationId: f.operationId,
      repoId: f.repo.repoId,
      ownerUserId: f.owner.id,
      slug: "meeting-review",
    }),
  ).toEqual(prepared);

  // Notes are invisible to git.
  await excludeNotes(f.cloneOf());
  await excludeNotes(f.cloneOf());
  await Bun.write(join(prepared.workdir, ".meeting/turns/001-r1-chair.md"), "notes\n");
  const repo = f.repos.getRepo(f.repo.repoId);
  if (!repo) throw new Error("no repo");
  expect(await ws.uncommitted(repo, f.cloneOf(), prepared.workdir)).toEqual([]);

  // Two members work in it; one goes home and asks for its branch to be deleted.
  for (const id of ["member-a", "member-b"]) {
    f.addAgent(id);
    f.db
      .update(agents)
      .set({ workdir: prepared.workdir, worktreeBranch: prepared.branch })
      .where(eq(agents.id, id))
      .run();
  }
  await ws.release({ agentId: "member-a", keepBranch: false });
  expect(await exists(prepared.workdir)).toBe(true);
  expect(await git(["branch", "--list", prepared.branch], f.cloneOf())).toContain(prepared.branch);

  // Bad start points are refused before git sees them.
  await expect(
    ws.prepare({
      agentId: "meeting-2",
      operationId: f.operationId,
      repoId: f.repo.repoId,
      ownerUserId: f.owner.id,
      slug: "x",
      base: "--upload-pack=evil",
    }),
  ).rejects.toThrow("invalid start point");

  // An admin prune after a restart keeps a live meeting's worktree.
  f.db
    .insert(meetings)
    .values({
      id: meetingId,
      operationId: f.operationId,
      repoId: f.repo.repoId,
      startedBy: f.owner.id,
      pattern: "review_panel",
      topic: "Review #7",
      rounds: 1,
      tokenBudget: 10_000,
      turnTimeoutMs: 60_000,
      output: "pr_review",
      workdir: prepared.workdir,
    })
    .run();
  const pruned = await f.restart().prune();
  expect(pruned.removed).toEqual([]);
  expect(await exists(prepared.workdir)).toBe(true);

  await ws.releaseShared({
    ownerUserId: f.owner.id,
    repoId: f.repo.repoId,
    workdir: prepared.workdir,
  });
  expect(await exists(prepared.workdir)).toBe(false);
  expect(await git(["branch", "--list", prepared.branch], f.cloneOf())).toContain(prepared.branch);
  expect(await git(["worktree", "list"], f.cloneOf())).not.toContain(meetingId);
});
