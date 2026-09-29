/**
 * One-click PR, the server side of `agent.pr` (SPEC §6; §10 M1).
 *
 * Agents commit their own work, so a dirty worktree is an error that lists
 * the files. Otherwise: fetch, push `office/<slug>` from the owner's own
 * clone (#114) with the floor repo's project credential (the office GitHub
 * connection's token when it covers the repo, else the repo's own PAT; never
 * a user's PAT, SPEC §8 / D14, #141), and open the PR via GitHub REST with a drafted title and
 * body (`Closes #n` when the agent works on an issue). An already open PR for the branch is returned as is.
 */
import { eq } from "drizzle-orm";
import { AUDIT_ACTIONS, writeAudit } from "../auth/audit.ts";
import type { Db } from "../db/index.ts";
import { agents } from "../db/schema/index.ts";
import { summarizeGitError } from "../github/git.ts";
import { GitHubApiError, type PullRequestClient } from "../github/pulls.ts";
import type { RepoAccess } from "../github/repo-access.ts";
import type { Logger } from "../logging.ts";
import { gitIn } from "./git-ops.ts";
import { WorkspaceError } from "./types.ts";
import type { GitWorktreeWorkspaces } from "./workspaces.ts";

export interface OpenPullRequestOptions {
  draft?: boolean;
  /** Overrides the drafted title / body (`agent.pr` may carry both). */
  title?: string;
  body?: string;
  /** Who clicked; recorded in the audit log. */
  actorUserId?: string;
}

export interface OpenedPullRequest {
  number: number;
  url: string;
  draft: boolean;
  /** False when an open PR for the branch already existed. */
  created: boolean;
  branch: string;
}

export interface Commit {
  sha: string;
  subject: string;
}

const MAX_TITLE = 200;
const MAX_LISTED_COMMITS = 50;

export function draftTitle(
  taskTitle: string | null | undefined,
  commits: readonly Commit[],
): string {
  const title = taskTitle?.trim() || commits[0]?.subject.trim() || "Changes from Regulus Office";
  return title.length > MAX_TITLE ? `${title.slice(0, MAX_TITLE - 1)}…` : title;
}

export function draftBody(input: {
  taskSummary?: string | null;
  issueNumber?: number | null;
  branch: string;
  commits: readonly Commit[];
}): string {
  const parts: string[] = [];
  if (input.taskSummary?.trim()) parts.push(input.taskSummary.trim());
  const listed = input.commits.slice(0, MAX_LISTED_COMMITS).map((c) => `- ${c.sha} ${c.subject}`);
  const more = input.commits.length - listed.length;
  if (more > 0) listed.push(`- … and ${more} more`);
  parts.push(`### Commits\n\n${listed.join("\n")}`);
  if (input.issueNumber) parts.push(`Closes #${input.issueNumber}`);
  parts.push(`---\nOpened from Regulus Office (branch \`${input.branch}\`).`);
  return parts.join("\n\n");
}

export interface PullRequestDeps {
  db: Db;
  repos: RepoAccess;
  workspaces: GitWorktreeWorkspaces;
  github: PullRequestClient;
  logger: Logger;
}

export class PullRequestService {
  readonly #deps: PullRequestDeps;

  constructor(deps: PullRequestDeps) {
    this.#deps = deps;
  }

  async openPullRequest(
    agentId: string,
    options: OpenPullRequestOptions = {},
  ): Promise<OpenedPullRequest> {
    const { db, repos, workspaces, github } = this.#deps;
    const row = db.select().from(agents).where(eq(agents.id, agentId)).get();
    if (!row) throw new WorkspaceError("agent_not_found");
    const branch = row.worktreeBranch;
    if (!branch) throw new WorkspaceError("no_worktree", "the agent has no worktree branch");
    const repo = repos.getRepo(row.repoId);
    if (!repo) throw new WorkspaceError("repo_not_found");
    const workdir = row.workdir;
    // The owner's own clone (#114); the shared mirror for a pre-#114 worktree.
    const { clone } = workspaces.cloneFor(row);
    const ctx = workspaces.ctx(clone, workdir);

    const opened = await workspaces.locks.run(clone, async () => {
      const dirty = await workspaces.uncommitted(repo, clone, workdir);
      if (dirty.length > 0) {
        throw new WorkspaceError(
          "uncommitted_changes",
          `the worktree has ${dirty.length} uncommitted change(s); ask the agent to commit first`,
          dirty.slice(0, 200),
        );
      }
      await workspaces.fetch(repo, clone);

      const log = await gitIn(
        ctx,
        [
          "log",
          "--reverse",
          "--format=%h%x1f%s",
          `origin/${repo.defaultBranch}..refs/heads/${branch}`,
        ],
        { cwd: clone },
      );
      if (log.code !== 0) {
        throw new WorkspaceError("worktree_failed", summarizeGitError(log.stderr, []));
      }
      const commits = log.stdout
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const [sha = "", subject = ""] = line.split("\x1f");
          return { sha, subject };
        });
      if (commits.length === 0) {
        throw new WorkspaceError(
          "no_commits",
          `${branch} has no commits on top of origin/${repo.defaultBranch}`,
        );
      }

      return repos.withRepoCredential(repo.repoId, async ({ token }) => {
        if (!token) {
          throw new WorkspaceError(
            "no_repo_credential",
            "this floor repo has no access token and the office GitHub connection does not cover it, so the office cannot push or open a PR",
          );
        }
        const ref = `refs/heads/${branch}`;
        const push = await gitIn(
          ctx,
          ["push", "--quiet", "--porcelain", "origin", `${ref}:${ref}`],
          { cwd: clone, token, tokenScope: repo.remoteUrl },
        );
        if (push.code !== 0) {
          throw new WorkspaceError(
            "push_failed",
            summarizeGitError(push.stderr || push.stdout, [token]),
          );
        }
        try {
          const result = await github.createOrFind(token, {
            owner: repo.owner,
            repo: repo.name,
            head: branch,
            base: repo.defaultBranch,
            title: options.title?.trim() || draftTitle(row.taskTitle, commits),
            body:
              options.body ??
              draftBody({
                taskSummary: row.taskSummary,
                issueNumber: row.issueNumber,
                branch,
                commits,
              }),
            draft: options.draft ?? false,
          });
          return { ...result.pull, created: result.kind === "created", branch };
        } catch (err) {
          if (err instanceof GitHubApiError) {
            throw new WorkspaceError("github_error", `GitHub: ${err.detail} (${err.status})`);
          }
          throw err;
        }
      });
    });

    db.transaction((tx) => {
      tx.update(agents).set({ prNumber: opened.number }).where(eq(agents.id, agentId)).run();
      writeAudit(tx, {
        userId: options.actorUserId ?? null,
        action: AUDIT_ACTIONS.agentPullRequest,
        targetKind: "agent",
        targetId: agentId,
        meta: {
          repo: `${repo.owner}/${repo.name}`,
          branch,
          number: opened.number,
          created: opened.created,
        },
      });
    });
    this.#deps.logger.info(
      { agentId, repoId: repo.repoId, number: opened.number, created: opened.created },
      "agent pull request opened",
    );
    return opened;
  }
}
