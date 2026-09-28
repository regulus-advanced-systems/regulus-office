/** Boot migration from the shared floor clone to per-human clones (#114). */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLogger } from "../logging.ts";
import { runnerId } from "../runners/layout.ts";
import { LAYOUT_MARKER, legacyWorktreeDirs, migrateLegacyLayout } from "./migrate.ts";

const logger = createLogger({ level: "silent" });
let root: string;

beforeAll(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "office-migrate-")));
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

async function layout(name: string) {
  const projectsDir = join(root, name, "projects");
  const worktreesDir = join(root, name, "worktrees");
  await mkdir(join(projectsDir, "floor", "repo", ".git"), { recursive: true });
  const rid = runnerId("user-a");
  const area = join(worktreesDir, "floor", rid);
  const oldWorktree = join(worktreesDir, "floor", "0f8c2d9e-agent");
  await mkdir(join(area, "_clones", "repo", ".git"), { recursive: true });
  await mkdir(join(area, "agent-1"), { recursive: true });
  await writeFile(join(area, "agent-1", ".git"), "gitdir: x\n");
  await mkdir(oldWorktree, { recursive: true });
  await writeFile(join(oldWorktree, ".git"), "gitdir: y\n");
  return { projectsDir, worktreesDir, area, oldWorktree };
}

describe("linux-user: reclaim", () => {
  test("reclaims the projects root and old per-agent worktrees once, never a human's area", async () => {
    const l = await layout("once");
    const reclaimed: string[] = [];
    const runner = { reclaim: async (dir: string) => void reclaimed.push(dir) };
    expect(await legacyWorktreeDirs(l.worktreesDir)).toEqual([l.oldWorktree]);
    await migrateLegacyLayout({ ...l, runner, logger });
    expect(reclaimed).toEqual([l.projectsDir, l.oldWorktree]);
    expect(await Bun.file(join(l.projectsDir, LAYOUT_MARKER)).exists()).toBe(true);
    await migrateLegacyLayout({ ...l, runner, logger });
    expect(reclaimed).toHaveLength(2);
  });

  test("a failed reclaim (old helper) leaves no marker, so the next boot retries", async () => {
    const l = await layout("retry");
    const runner = {
      reclaim: async () => {
        throw new Error("sudo: a password is required");
      },
    };
    await migrateLegacyLayout({ ...l, runner, logger });
    expect(await Bun.file(join(l.projectsDir, LAYOUT_MARKER)).exists()).toBe(false);
  });
});

describe("docker: whole-floor mounts", () => {
  test("every recovered runner is reconciled on every boot; nothing is reclaimed", async () => {
    const l = await layout("docker");
    const reconciled: string[] = [];
    const runner = {
      recover: async () => [
        { userId: "u1", backend: "docker" as const, home: "/h", tmuxSocket: "/s" },
        { userId: "u2", backend: "docker" as const, home: "/h", tmuxSocket: "/s" },
      ],
      reconcileMounts: async (user: { userId: string }) => {
        reconciled.push(user.userId);
        return user.userId === "u1";
      },
    };
    await migrateLegacyLayout({ ...l, runner, logger });
    await migrateLegacyLayout({ ...l, runner, logger });
    expect(reconciled).toEqual(["u1", "u2", "u1", "u2"]);
    expect(await Bun.file(join(l.projectsDir, LAYOUT_MARKER)).exists()).toBe(false);
  });
});
