/**
 * Test fixtures for floors: local bare git repos served as `file://`
 * remotes (no network), and an in-memory database with users.
 */
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { UserRole } from "@regulus/protocol";
import { MEMORY_DB_PATH, openDatabase, runMigrations } from "../db/index.ts";
import { userProfiles, users } from "../db/schema/index.ts";
import { gitBaseEnv } from "../github/git.ts";

export const FAKE_PAT = "github_pat_FAKE_0123456789abcdefghijklmnopqrstuvwxyz";

async function git(args: string[], cwd?: string): Promise<void> {
  const proc = Bun.spawn(
    ["git", "-c", "user.name=Test", "-c", "user.email=t@example.com", ...args],
    {
      cwd,
      env: gitBaseEnv(),
      stdout: "ignore",
      stderr: "pipe",
    },
  );
  const code = await proc.exited;
  if (code !== 0)
    throw new Error(`git ${args[0]} failed: ${await new Response(proc.stderr).text()}`);
}

/**
 * Creates `<root>/<owner>/<name>.git` with one commit on `branch` and HEAD
 * pointing at it. Returns the `file://` base to use as OFFICE_GITHUB_REMOTE_BASE.
 */
export async function makeBareRepo(
  root: string,
  owner: string,
  name: string,
  branch = "trunk",
): Promise<string> {
  const bare = join(root, owner, `${name}.git`);
  await mkdir(join(root, owner), { recursive: true });
  await git(["init", "--quiet", "--bare", `--initial-branch=${branch}`, bare]);
  const work = await mkdtemp(join(tmpdir(), "office-work-"));
  await git(["init", "--quiet", `--initial-branch=${branch}`, work]);
  await Bun.write(join(work, "README.md"), `# ${name}\n`);
  await git(["add", "README.md"], work);
  await git(["commit", "--quiet", "-m", "initial"], work);
  await git(["push", "--quiet", bare, `${branch}:${branch}`], work);
  return `file://${root}`;
}

export function testDb() {
  const db = openDatabase({ path: MEMORY_DB_PATH });
  runMigrations(db);
  let seq = 0;
  const addUser = (displayName: string, role: UserRole) => {
    seq += 1;
    const id = `user-${seq}`;
    db.insert(users)
      .values({ id, name: displayName, email: `${id}@example.com`, emailVerified: false })
      .run();
    db.insert(userProfiles).values({ userId: id, displayName, role }).run();
    return { id, role };
  };
  return { db, addUser };
}
