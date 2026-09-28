/**
 * {@link Workspaces} over `git worktree` (SPEC §8, §10 M1), on each human's
 * own clone of the floor repo (#114, clones.ts; layout in
 * ../runners/layout.ts).
 *
 * prepare: make the owner's clone on first use, `git fetch origin` in it with
 * the project credential, then `git worktree add --no-track -b office/<slug>
 * <worktreesDir>/<floor>/<rid>/<agentId> origin/<default>`, so an agent never
 * starts from a stale local branch (agent-office #119). The owner's runner is
 * given access with `mountProject` (their own area only), and the branch and
 * workdir are recorded on the agent row.
 *
 * release: remove the worktree; keep the branch, or delete it locally and on
 * the remote. Only `office/` branches are ever deleted.
 *
 * Agents from before #114 have worktrees of the shared mirror
 * (`<worktreesDir>/<floor>/<agentId>`). {@link GitWorktreeWorkspaces.cloneFor}
 * reports them as `legacy`: the office's own git (status, PR, release) still
 * works on them, but they are never started in a runner again.
 */
import { rm, stat } from "node:fs/promises";
import { basename, isAbsolute, join, relative } from "node:path";
import { and, eq } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { agents, floors } from "../db/schema/index.ts";
import { type GitRunner, runGit, summarizeGitError } from "../github/git.ts";
import type { RepoAccess, RepoCheckout } from "../github/repo-access.ts";
import type { Logger } from "../logging.ts";
import { CLONES_DIR, humanAreaDir, humanAreaOf } from "../runners/layout.ts";
import type { Runner } from "../runners/types.ts";
import { ensureHumanClone, fetchOrigin } from "./clones.ts";
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
  type AgentClone,
  type HumanClones,
  type PreparedWorkspace,
  type PrepareWorkspaceInput,
  type ReleaseWorkspaceInput,
  WorkspaceError,
  type Workspaces,
} from "./types.ts";

export interface WorktreeDeps {
  db: Db;
  repos: RepoAccess;
  /** Humans' areas: `<worktreesDir>/<floor-slug>/<rid>/{_clones/<repo>,<agentId>}`. */
  worktreesDir: string;
  logger: Logger;
  /** Grants the owner's runner access to their clone and the worktree. */
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

export class GitWorktreeWorkspaces implements Workspaces, HumanClones {
  readonly #deps: WorktreeDeps;
  readonly #git: GitRunner;
  /** Keyed by clone path (a human's clone or a mirror). */
  readonly locks: KeyedMutex;
  /** Agents prepared by this process; their rows may not be inserted yet, so prune skips them. */
  readonly #prepared = new Set<string>();

  constructor(deps: WorktreeDeps) {
    this.#deps = deps;
    this.#git = deps.git ?? runGit;
    this.locks = deps.locks ?? new KeyedMutex();
  }

  get #cloneDeps() {
    const { repos, logger } = this.#deps;
    return { repos, logger, git: this.#git, locks: this.locks };
  }

  /** Git context trusting the clone and (when given) one worktree. */
  ctx(clone: string, worktree?: string): GitContext {
    return { git: this.#git, safe: worktree ? [clone, worktree] : [clone] };
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

  /** The ready repo, and the owner's area and clone paths for a spawn on it. */
  #target(input: PrepareWorkspaceInput) {
    const repo = this.#readyRepo(input.repoId);
    if (repo.floorId !== input.floorId) throw new WorkspaceError("repo_not_found");
    const floor = this.#deps.db
      .select({ slug: floors.slug })
      .from(floors)
      .where(eq(floors.id, input.floorId))
      .get();
    if (!floor) throw new WorkspaceError("repo_not_found", "floor not found");
    const area = humanAreaDir(this.#deps.worktreesDir, floor.slug, input.ownerUserId);
    return { repo, area, clone: join(area, CLONES_DIR, basename(repo.workdir)) };
  }

  /**
   * Where an agent's git lives: its owner's clone when the workdir is in the
   * owner's own area, otherwise (a worktree of the shared mirror, or the
   * mirror itself) the mirror, flagged `legacy`.
   */
  cloneFor(agent: { ownerUserId: string; repoId: string; workdir: string }): AgentClone {
    const repo = this.#deps.repos.getRepo(agent.repoId);
    if (!repo) throw new WorkspaceError("repo_not_found");
    const area = humanAreaOf(agent.workdir, this.#deps.worktreesDir, agent.ownerUserId);
    if (!area) return { clone: repo.workdir, legacy: true };
    return { clone: join(area, CLONES_DIR, basename(repo.workdir)), legacy: false };
  }

  /** `git fetch origin` in `clone` with the project credential, sent only to the repo's remote. */
  fetch(repo: RepoCheckout, clone: string): Promise<void> {
    return fetchOrigin(this.#cloneDeps, repo, clone);
  }

  async #mount(ownerUserId: string, repo: RepoCheckout, workdirs: string[]): Promise<void> {
    const runner = this.#deps.runner;
    if (!runner) return;
    for (const workdir of workdirs) {
      await runner.mountProject(
        { userId: ownerUserId },
        { floorId: repo.floorId, repoId: repo.repoId, workdir },
      );
    }
  }

  async prepareClone(input: PrepareWorkspaceInput): Promise<PreparedWorkspace> {
    const { repo, area, clone } = this.#target(input);
    await this.locks.run(clone, () => ensureHumanClone(this.#cloneDeps, repo, clone, area));
    await this.#mount(input.ownerUserId, repo, [clone]);
    return { workdir: clone, branch: repo.defaultBranch };
  }

  async prepare(input: PrepareWorkspaceInput): Promise<PreparedWorkspace> {
    const agentDir = checkAgentDirName(input.agentId);
    const { repo, area, clone } = this.#target(input);
    const workdir = join(area, agentDir);
    const log = this.#deps.logger.child({ agentId: input.agentId, repoId: repo.repoId });

    this.#prepared.add(input.agentId);
    const prepared = await this.locks.run(clone, async () => {
      await ensureHumanClone(this.#cloneDeps, repo, clone, area);
      // Idempotent: an existing worktree for this agent (e.g. after a restart) is reused.
      const existing = await this.#registeredBranch(clone, workdir);
      if (existing) return { workdir, branch: existing };
      if (await isDir(workdir)) {
        throw new WorkspaceError("worktree_failed", `${workdir} exists but is not a worktree`);
      }
      await this.fetch(repo, clone);
      const base = `origin/${repo.defaultBranch}`;
      // Branch names must be unique per repo across every human's clone (one remote).
      return this.locks.run(`branches:${repo.repoId}`, async () => {
        const branch = await this.#uniqueBranch(repo, clone, branchSlug(input.slug));
        const res = await gitIn(
          this.ctx(clone, workdir),
          ["worktree", "add", "--quiet", "--no-track", "-b", branch, workdir, base],
          { cwd: clone },
        );
        if (res.code !== 0) {
          throw new WorkspaceError("worktree_failed", summarizeGitError(res.stderr, []));
        }
        this.#record(input.agentId, workdir, branch);
        log.info({ workdir, branch, base }, "agent worktree created");
        return { workdir, branch };
      });
    });

    await this.#mount(input.ownerUserId, repo, [clone, workdir]);
    this.#record(input.agentId, prepared.workdir, prepared.branch);
    return prepared;
  }

  #record(agentId: string, workdir: string, branch: string): void {
    this.#deps.db
      .update(agents)
      .set({ workdir, worktreeBranch: branch })
      .where(eq(agents.id, agentId))
      .run();
  }

  /** Branch of the registered worktree at `workdir`, or null. */
  async #registeredBranch(clone: string, workdir: string): Promise<string | null> {
    const res = await gitIn(this.ctx(clone), ["worktree", "list", "--porcelain", "-z"], {
      cwd: clone,
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

  async #refExists(clone: string, ref: string): Promise<boolean> {
    const res = await gitIn(this.ctx(clone), ["rev-parse", "--verify", "--quiet", ref], {
      cwd: clone,
    });
    return res.code === 0;
  }

  /**
   * `office/<slug>`, or `office/<slug>-2`, ... when taken in this clone, on the
   * remote, or by another agent on the repo (another human's unpushed branch).
   */
  async #uniqueBranch(repo: RepoCheckout, clone: string, slug: string): Promise<string> {
    for (let n = 1; n <= MAX_SUFFIX; n++) {
      const branch = `${BRANCH_PREFIX}${n === 1 ? slug : `${slug}-${n}`}`;
      const claimed = this.#deps.db
        .select({ id: agents.id })
        .from(agents)
        .where(and(eq(agents.repoId, repo.repoId), eq(agents.worktreeBranch, branch)))
        .get();
      const taken =
        claimed !== undefined ||
        (await this.#refExists(clone, `refs/heads/${branch}`)) ||
        (await this.#refExists(clone, `refs/remotes/origin/${branch}`));
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
    const { clone } = this.cloneFor(row);
    return {
      workdir: row.workdir,
      branch: row.worktreeBranch,
      uncommitted: await this.uncommitted(repo, clone, row.workdir),
    };
  }

  /** Uncommitted paths in a worktree, run against the trusted admin dir. */
  async uncommitted(repo: RepoCheckout, clone: string, workdir: string): Promise<string[]> {
    const admin = await findAdminDir(clone, workdir);
    if (!admin) throw new WorkspaceError("no_worktree", "the agent's worktree is missing");
    // `status` may run clean filters, so the clone's config is checked first.
    await assertSafeClone(this.ctx(clone), clone, repo.remoteUrl, admin);
    const res = await gitIn(
      this.ctx(clone, workdir),
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
    const { clone } = this.cloneFor(row);
    const branch = row.worktreeBranch;
    const log = this.#deps.logger.child({ agentId: row.id, repoId: repo.repoId });
    let remoteError: WorkspaceError | undefined;

    await this.locks.run(clone, async () => {
      const ctx = this.ctx(clone, row.workdir);
      // An agent without a worktree (`autoWorktree: false`) works in the clone itself: keep it.
      if (row.workdir !== clone && this.isManaged(row.workdir)) {
        const res = await gitIn(ctx, ["worktree", "remove", "--force", "--force", row.workdir], {
          cwd: clone,
        });
        if (res.code !== 0) await rm(row.workdir, { recursive: true, force: true });
        await gitIn(ctx, ["worktree", "prune"], { cwd: clone });
        log.info({ workdir: row.workdir }, "agent worktree removed");
      }
      if (input.keepBranch || !branch?.startsWith(BRANCH_PREFIX)) return;
      await gitIn(ctx, ["branch", "--quiet", "-D", branch], { cwd: clone });
      remoteError = await this.#deleteRemoteBranch(repo, clone, branch);
      log.info({ branch, remote: !remoteError }, "agent branch deleted");
    });

    if (!input.keepBranch) {
      this.#deps.db.update(agents).set({ worktreeBranch: null }).where(eq(agents.id, row.id)).run();
    }
    if (remoteError) throw remoteError;
  }

  async #deleteRemoteBranch(repo: RepoCheckout, clone: string, branch: string) {
    try {
      await assertSafeClone(this.ctx(clone), clone, repo.remoteUrl);
    } catch (err) {
      return err as WorkspaceError;
    }
    return this.#deps.repos.withRepoCredential(repo.repoId, async ({ token }) => {
      const opts = { cwd: clone, token, tokenScope: repo.remoteUrl };
      const ref = `refs/heads/${branch}`;
      const listed = await gitIn(this.ctx(clone), ["ls-remote", "--heads", "origin", ref], opts);
      if (listed.code !== 0) {
        return new WorkspaceError("push_failed", summarizeGitError(listed.stderr, [token]));
      }
      if (!listed.stdout.trim()) return undefined;
      const res = await gitIn(this.ctx(clone), ["push", "--quiet", "origin", `:${ref}`], opts);
      if (res.code !== 0) {
        return new WorkspaceError("push_failed", summarizeGitError(res.stderr, [token]));
      }
      await gitIn(this.ctx(clone), ["branch", "-r", "-D", `origin/${branch}`], { cwd: clone });
      return undefined;
    });
  }
}
