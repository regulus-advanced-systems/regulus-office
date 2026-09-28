/**
 * {@link Workspaces} over `git worktree` (SPEC §8, §10 M1).
 *
 * prepare: `git fetch origin` with the project credential first, then
 * `git worktree add --no-track -b office/<slug> <worktreesDir>/<floor>/<agentId>
 * origin/<default>`, so an agent never starts from a stale local branch
 * (agent-office #119). The runner is given access with `mountProject`, and the
 * branch and workdir are recorded on the agent row.
 *
 * release: remove the worktree; keep the branch, or delete it locally and on
 * the remote. Only `office/` branches are ever deleted.
 */
import { mkdir, rm, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative } from "node:path";
import { eq } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { agents, floors } from "../db/schema/index.ts";
import { type GitRunner, runGit, summarizeGitError } from "../github/git.ts";
import type { RepoAccess, RepoCheckout } from "../github/repo-access.ts";
import type { Logger } from "../logging.ts";
import type { Runner } from "../runners/types.ts";
import {
  assertSafeClone,
  BRANCH_PREFIX,
  branchSlug,
  checkAgentDirName,
  findAdminDir,
  type GitContext,
  gitIn,
  KeyedMutex,
  parsePorcelain,
  worktreeArgs,
} from "./git-ops.ts";
import {
  type PreparedWorkspace,
  type PrepareWorkspaceInput,
  type ReleaseWorkspaceInput,
  WorkspaceError,
  type Workspaces,
} from "./types.ts";

export interface WorktreeDeps {
  db: Db;
  repos: RepoAccess;
  /** `<worktreesDir>/<floor-slug>/<agentId>`. */
  worktreesDir: string;
  logger: Logger;
  /** Grants the owner's runner access to the clone and the worktree. */
  runner?: Pick<Runner, "mountProject">;
  git?: GitRunner;
  /** Shared with the PR service so pushes and worktree changes do not interleave. */
  locks?: KeyedMutex;
}

export interface WorkspaceStatus {
  workdir: string;
  branch: string;
  /** Paths with uncommitted changes (tracked or untracked). */
  uncommitted: string[];
}

const MAX_SUFFIX = 100;

async function isDir(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

export class GitWorktreeWorkspaces implements Workspaces {
  readonly #deps: WorktreeDeps;
  readonly #git: GitRunner;
  readonly locks: KeyedMutex;
  /** Agents prepared by this process; their rows may not be inserted yet, so prune skips them. */
  readonly #prepared = new Set<string>();

  constructor(deps: WorktreeDeps) {
    this.#deps = deps;
    this.#git = deps.git ?? runGit;
    this.locks = deps.locks ?? new KeyedMutex();
  }

  /** Git context trusting the clone and (when given) one worktree. */
  ctx(repo: RepoCheckout, worktree?: string): GitContext {
    return { git: this.#git, safe: worktree ? [repo.workdir, worktree] : [repo.workdir] };
  }

  /** Prepared by this process and not released (prune must not touch it). */
  isActive(agentId: string): boolean {
    return this.#prepared.has(agentId);
  }

  /** True when `path` is a directory inside the managed worktrees root. */
  isManaged(path: string): boolean {
    const rel = relative(this.#deps.worktreesDir, path);
    return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
  }

  #readyRepo(repoId: string): RepoCheckout {
    const repo = this.#deps.repos.getRepo(repoId);
    if (!repo) throw new WorkspaceError("repo_not_found");
    if (repo.cloneStatus !== "ready") {
      throw new WorkspaceError("repo_not_ready", `the repo clone is ${repo.cloneStatus}`);
    }
    return repo;
  }

  /** `git fetch origin` with the project credential, sent only to the repo's remote. */
  async fetch(repo: RepoCheckout): Promise<void> {
    await assertSafeClone(this.ctx(repo), repo.workdir, repo.remoteUrl);
    await this.#deps.repos.withRepoCredential(repo.repoId, async ({ token }) => {
      const res = await gitIn(this.ctx(repo), ["fetch", "--quiet", "--prune", "origin"], {
        cwd: repo.workdir,
        token,
        tokenScope: repo.remoteUrl,
      });
      if (res.code !== 0) {
        throw new WorkspaceError("fetch_failed", summarizeGitError(res.stderr, [token]));
      }
    });
  }

  async prepare(input: PrepareWorkspaceInput): Promise<PreparedWorkspace> {
    const agentDir = checkAgentDirName(input.agentId);
    const repo = this.#readyRepo(input.repoId);
    if (repo.floorId !== input.floorId) throw new WorkspaceError("repo_not_found");
    const floor = this.#deps.db
      .select({ slug: floors.slug })
      .from(floors)
      .where(eq(floors.id, input.floorId))
      .get();
    if (!floor) throw new WorkspaceError("repo_not_found", "floor not found");
    const workdir = join(this.#deps.worktreesDir, floor.slug, agentDir);
    const log = this.#deps.logger.child({ agentId: input.agentId, repoId: repo.repoId });

    this.#prepared.add(input.agentId);
    const prepared = await this.locks.run(repo.repoId, async () => {
      const ctx = this.ctx(repo, workdir);
      // Idempotent: an existing worktree for this agent (e.g. after a restart) is reused.
      const existing = await this.#registeredBranch(repo, workdir);
      if (existing) return { workdir, branch: existing };
      if (await isDir(workdir)) {
        throw new WorkspaceError("worktree_failed", `${workdir} exists but is not a worktree`);
      }
      await this.fetch(repo);
      const base = `origin/${repo.defaultBranch}`;
      const branch = await this.#uniqueBranch(repo, branchSlug(input.slug));
      await mkdir(dirname(workdir), { recursive: true });
      const res = await gitIn(
        ctx,
        ["worktree", "add", "--quiet", "--no-track", "-b", branch, workdir, base],
        { cwd: repo.workdir },
      );
      if (res.code !== 0) {
        throw new WorkspaceError("worktree_failed", summarizeGitError(res.stderr, []));
      }
      log.info({ workdir, branch, base }, "agent worktree created");
      return { workdir, branch };
    });

    const runner = this.#deps.runner;
    if (runner) {
      const user = { userId: input.ownerUserId };
      await runner.mountProject(user, {
        floorId: repo.floorId,
        repoId: repo.repoId,
        workdir: repo.workdir,
      });
      await runner.mountProject(user, { floorId: repo.floorId, repoId: repo.repoId, workdir });
    }
    this.#deps.db
      .update(agents)
      .set({ workdir: prepared.workdir, worktreeBranch: prepared.branch })
      .where(eq(agents.id, input.agentId))
      .run();
    return prepared;
  }

  /** Branch of the registered worktree at `workdir`, or null. */
  async #registeredBranch(repo: RepoCheckout, workdir: string): Promise<string | null> {
    const res = await gitIn(this.ctx(repo), ["worktree", "list", "--porcelain", "-z"], {
      cwd: repo.workdir,
    });
    if (res.code !== 0) return null;
    let current: string | null = null;
    for (const line of res.stdout.split("\0")) {
      if (line.startsWith("worktree ")) current = line.slice("worktree ".length);
      else if (current === workdir && line.startsWith("branch refs/heads/")) {
        return line.slice("branch refs/heads/".length);
      }
    }
    return null;
  }

  async #refExists(repo: RepoCheckout, ref: string): Promise<boolean> {
    const res = await gitIn(this.ctx(repo), ["rev-parse", "--verify", "--quiet", ref], {
      cwd: repo.workdir,
    });
    return res.code === 0;
  }

  /** `office/<slug>`, or `office/<slug>-2`, ... when taken locally or on the remote. */
  async #uniqueBranch(repo: RepoCheckout, slug: string): Promise<string> {
    for (let n = 1; n <= MAX_SUFFIX; n++) {
      const branch = `${BRANCH_PREFIX}${n === 1 ? slug : `${slug}-${n}`}`;
      const taken =
        (await this.#refExists(repo, `refs/heads/${branch}`)) ||
        (await this.#refExists(repo, `refs/remotes/origin/${branch}`));
      if (!taken) return branch;
    }
    throw new WorkspaceError("worktree_failed", `no free branch name for office/${slug}`);
  }

  #agent(agentId: string) {
    return this.#deps.db.select().from(agents).where(eq(agents.id, agentId)).get();
  }

  /** Where an agent works and what it has not committed yet (for the send-home and PR dialogs). */
  async status(agentId: string): Promise<WorkspaceStatus> {
    const row = this.#agent(agentId);
    if (!row) throw new WorkspaceError("agent_not_found");
    if (!row.worktreeBranch) throw new WorkspaceError("no_worktree");
    const repo = this.#readyRepo(row.repoId);
    return {
      workdir: row.workdir,
      branch: row.worktreeBranch,
      uncommitted: await this.uncommitted(repo, row.workdir),
    };
  }

  /** Uncommitted paths in a worktree, run against the trusted admin dir. */
  async uncommitted(repo: RepoCheckout, workdir: string): Promise<string[]> {
    const admin = await findAdminDir(repo.workdir, workdir);
    if (!admin) throw new WorkspaceError("no_worktree", "the agent's worktree is missing");
    // `status` may run clean filters, so the shared config is checked first.
    await assertSafeClone(this.ctx(repo), repo.workdir, repo.remoteUrl, admin);
    const res = await gitIn(
      this.ctx(repo, workdir),
      [...worktreeArgs(admin, workdir), "status", "--porcelain=v1", "-z", "--untracked-files=all"],
      { cwd: workdir },
    );
    if (res.code !== 0) {
      throw new WorkspaceError("worktree_failed", summarizeGitError(res.stderr, []));
    }
    return parsePorcelain(res.stdout);
  }

  async release(input: ReleaseWorkspaceInput): Promise<void> {
    const row = this.#agent(input.agentId);
    this.#prepared.delete(input.agentId);
    if (!row) return;
    const repo = this.#deps.repos.getRepo(row.repoId);
    if (!repo) return;
    const branch = row.worktreeBranch;
    const log = this.#deps.logger.child({ agentId: row.id, repoId: repo.repoId });
    let remoteError: WorkspaceError | undefined;

    await this.locks.run(repo.repoId, async () => {
      const ctx = this.ctx(repo, row.workdir);
      if (this.isManaged(row.workdir)) {
        const res = await gitIn(ctx, ["worktree", "remove", "--force", "--force", row.workdir], {
          cwd: repo.workdir,
        });
        if (res.code !== 0) await rm(row.workdir, { recursive: true, force: true });
        await gitIn(ctx, ["worktree", "prune"], { cwd: repo.workdir });
        log.info({ workdir: row.workdir }, "agent worktree removed");
      }
      if (input.keepBranch || !branch?.startsWith(BRANCH_PREFIX)) return;
      await gitIn(ctx, ["branch", "--quiet", "-D", branch], { cwd: repo.workdir });
      remoteError = await this.#deleteRemoteBranch(repo, branch);
      log.info({ branch, remote: !remoteError }, "agent branch deleted");
    });

    if (!input.keepBranch) {
      this.#deps.db.update(agents).set({ worktreeBranch: null }).where(eq(agents.id, row.id)).run();
    }
    if (remoteError) throw remoteError;
  }

  async #deleteRemoteBranch(repo: RepoCheckout, branch: string) {
    try {
      await assertSafeClone(this.ctx(repo), repo.workdir, repo.remoteUrl);
    } catch (err) {
      return err as WorkspaceError;
    }
    return this.#deps.repos.withRepoCredential(repo.repoId, async ({ token }) => {
      const opts = { cwd: repo.workdir, token, tokenScope: repo.remoteUrl };
      const ref = `refs/heads/${branch}`;
      const listed = await gitIn(this.ctx(repo), ["ls-remote", "--heads", "origin", ref], opts);
      if (listed.code !== 0) {
        return new WorkspaceError("push_failed", summarizeGitError(listed.stderr, [token]));
      }
      if (!listed.stdout.trim()) return undefined;
      const res = await gitIn(this.ctx(repo), ["push", "--quiet", "origin", `:${ref}`], opts);
      if (res.code !== 0) {
        return new WorkspaceError("push_failed", summarizeGitError(res.stderr, [token]));
      }
      await gitIn(this.ctx(repo), ["branch", "-r", "-D", `origin/${branch}`], {
        cwd: repo.workdir,
      });
      return undefined;
    });
  }
}
