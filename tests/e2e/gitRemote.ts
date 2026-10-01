/**
 * A local bare git repo standing in for a GitHub repo: the e2e server clones
 * from `file://<E2E_DATA_DIR>/remotes` (OFFICE_GITHUB_REMOTE_BASE), so operation
 * creation is tested without network access.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const env = {
  PATH: process.env.PATH ?? "/usr/bin:/bin",
  HOME: tmpdir(),
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
};

function git(args: string[], cwd?: string): void {
  execFileSync("git", ["-c", "user.name=E2E", "-c", "user.email=e2e@example.com", ...args], {
    cwd,
    env,
    stdio: "ignore",
  });
}

/** Creates `<dataDir>/remotes/<owner>/<name>.git` with one commit on `branch`. */
export function createRemoteRepo(dataDir: string, owner: string, name: string, branch = "trunk") {
  const bare = join(dataDir, "remotes", owner, `${name}.git`);
  mkdirSync(join(dataDir, "remotes", owner), { recursive: true });
  git(["init", "--quiet", "--bare", `--initial-branch=${branch}`, bare]);
  const work = mkdtempSync(join(tmpdir(), "regulus-e2e-work-"));
  git(["init", "--quiet", `--initial-branch=${branch}`, work]);
  writeFileSync(join(work, "README.md"), `# ${name}\n`);
  git(["add", "README.md"], work);
  git(["commit", "--quiet", "-m", "initial"], work);
  git(["push", "--quiet", bare, `${branch}:${branch}`], work);
}
