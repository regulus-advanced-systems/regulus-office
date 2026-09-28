/**
 * Each human's own clone of a floor repo (#114).
 *
 * The floor clone from #30 (`<projects>/<floor>/<repo>`) is an office-only
 * mirror: the office fetches into it with the floor credential, and no
 * runner can reach it. On a human's first spawn on a repo the office makes
 * `<worktrees>/<floor>/<rid>/_clones/<repo>` (../runners/layout.ts):
 *
 * 1. fetch the mirror from GitHub (hardened, token scoped to the remote);
 * 2. `git init --shared=group` a temp dir, `origin` = the real remote;
 * 3. fetch `refs/remotes/origin/*` and tags from the mirror over the local
 *    git transport, so index-pack checks every object it copies (a plain
 *    file copy or hardlinks would not, and hardlinked packs would share one
 *    inode, and its ACLs, between humans);
 * 4. check out the default branch, rename into place.
 *
 * Object sharing: none. Alternates into the mirror (`--reference`,
 * `--shared`) would need every runner to read office-owned files, and a gc
 * in the mirror could drop objects a human's clone depends on. Each clone
 * carries its own packed object store instead: one extra copy per human
 * per repo on disk, in exchange for a clone that depends on nothing outside
 * the human's own area.
 */
import { randomUUID } from "node:crypto";
import { chmod, mkdir, rename, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { type GitRunner, summarizeGitError } from "../github/git.ts";
import type { RepoAccess, RepoCheckout } from "../github/repo-access.ts";
import type { Logger } from "../logging.ts";
import { assertSafeClone, type GitContext, gitIn, type KeyedMutex } from "./git-ops.ts";
import { WorkspaceError } from "./types.ts";

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Create `dir` (and parents) and take away "other" permissions from it:
 * other humans' runners may traverse the floor dir, so a human's area must
 * only be open to its owner (the office) and group or ACL. Keeps setgid.
 */
export async function ensurePrivateDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  const { mode } = await stat(dir);
  if ((mode & 0o007) !== 0) await chmod(dir, mode & 0o7770);
}

export interface CloneDeps {
  repos: RepoAccess;
  git: GitRunner;
  logger: Logger;
  /** Keyed by clone path (the mirror's too), shared with worktree and PR work. */
  locks: KeyedMutex;
}

/** Fetch `origin` into `clone` with the floor credential, sent only to the repo's remote. */
export async function fetchOrigin(
  deps: CloneDeps,
  repo: RepoCheckout,
  clone: string,
): Promise<void> {
  const ctx: GitContext = { git: deps.git, safe: [clone] };
  await assertSafeClone(ctx, clone, repo.remoteUrl);
  await deps.repos.withRepoCredential(repo.repoId, async ({ token }) => {
    const res = await gitIn(ctx, ["fetch", "--quiet", "--prune", "origin"], {
      cwd: clone,
      token,
      tokenScope: repo.remoteUrl,
    });
    if (res.code !== 0) {
      throw new WorkspaceError("fetch_failed", summarizeGitError(res.stderr, [token]));
    }
  });
}

/**
 * Make `clone` (the human's own clone) from the mirror unless it exists.
 * Callers hold the lock for `clone`; the mirror is locked here while it is
 * fetched and read (lock order: human clone, then mirror).
 */
export async function ensureHumanClone(
  deps: CloneDeps,
  repo: RepoCheckout,
  clone: string,
  area: string,
): Promise<void> {
  if (await exists(join(clone, ".git"))) return;
  if (await exists(clone)) {
    throw new WorkspaceError("worktree_failed", `${clone} exists but is not a git clone`);
  }
  await ensurePrivateDir(area);
  await mkdir(dirname(clone), { recursive: true });

  const partial = `${clone}.partial-${randomUUID().slice(0, 8)}`;
  const ctx: GitContext = { git: deps.git, safe: [partial, repo.workdir] };
  const step = async (args: string[], cwd: string) => {
    const res = await gitIn(ctx, args, { cwd });
    if (res.code !== 0) {
      throw new WorkspaceError("worktree_failed", summarizeGitError(res.stderr, []));
    }
  };
  try {
    // Group-shared git dir: the human's runner (another uid; ACL or shared gid) commits
    // into it from worktrees, whatever its umask, and the office still writes refs.
    await step(["init", "--quiet", "--shared=group", partial], dirname(clone));
    await step(["remote", "add", "origin", repo.remoteUrl], partial);
    await deps.locks.run(repo.workdir, async () => {
      await fetchOrigin(deps, repo, repo.workdir);
      const seed = ["+refs/remotes/origin/*:refs/remotes/origin/*", "+refs/tags/*:refs/tags/*"];
      await step(["fetch", "--quiet", "--no-tags", repo.workdir, ...seed], partial);
    });
    // The mirror's `origin/HEAD` arrives as a plain ref; point it at the default branch.
    const head = `refs/remotes/origin/${repo.defaultBranch}`;
    await step(["symbolic-ref", "refs/remotes/origin/HEAD", head], partial);
    await step(
      ["checkout", "--quiet", "-B", repo.defaultBranch, "--track", `origin/${repo.defaultBranch}`],
      partial,
    );
    await rename(partial, clone);
  } catch (err) {
    await rm(partial, { recursive: true, force: true });
    throw err;
  }
  deps.logger.info({ repoId: repo.repoId, clone }, "human clone created from the floor mirror");
}
