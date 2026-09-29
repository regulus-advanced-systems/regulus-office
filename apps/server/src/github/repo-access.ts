/**
 * The seam for server-side git on floor repos (#31 worktrees, push, PR):
 * where a repo lives on disk, its default branch, and — for the duration of
 * one callback — its decrypted project credential.
 *
 *   await repos.withRepoCredential(repoId, async ({ repo, token, gitEnv, redact }) => {
 *     const r = await runGit(["push", "origin", branch], { cwd: repo.workdir, token });
 *   });
 *
 * Token selection (#141): the office GitHub connection's token (a one-hour
 * installation token narrowed to the repo, or the org PAT) when the
 * connection covers the repo, else the repo's own stored PAT, else none.
 *
 * Rules (SPEC §8): the token is for git commands the office itself runs.
 * Do not log it, return it to a client, or pass it into an agent's env.
 */
import type { RepoCloneStatus } from "@regulus/protocol";
import { eq } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { floorRepos } from "../db/schema/index.ts";
import { RepoCredentialError, type RepoCredentialVault } from "./credentials.ts";
import { gitAuthEnv, redactGitOutput } from "./git.ts";
import { GitHubApiError } from "./pulls.ts";
import { repoRemoteUrl } from "./repo-ref.ts";

export interface RepoCheckout {
  repoId: string;
  floorId: string;
  owner: string;
  name: string;
  /** Absolute clone path, `<projectsDir>/<floor-slug>/<repo>`. */
  workdir: string;
  defaultBranch: string;
  /** Credential-free clone remote. */
  remoteUrl: string;
  cloneStatus: RepoCloneStatus;
  isPrimary: boolean;
}

export interface RepoCredential {
  repo: RepoCheckout;
  /** The token, or null for a public repo without one. Valid only inside the callback. */
  token: string | null;
  /** Where the token came from: the office GitHub connection, the repo's own PAT, or none. */
  source: "connection" | "repo" | null;
  /** `http.extraHeader` env for one git command (empty without a token). */
  gitEnv: Record<string, string>;
  /** Strip the token (and any URL credentials) from text before logging or storing it. */
  redact(text: string): string;
}

export interface RepoAccess {
  getRepo(repoId: string): RepoCheckout | undefined;
  listFloorRepos(floorId: string): RepoCheckout[];
  /** Run `fn` with the repo's decrypted credential. Throws when the repo is unknown. */
  withRepoCredential<T>(
    repoId: string,
    fn: (credential: RepoCredential) => T | Promise<T>,
  ): Promise<T>;
}

export class RepoNotFoundError extends Error {
  override name = "RepoNotFoundError";
}

type RepoRow = typeof floorRepos.$inferSelect;

/** The slice of the office GitHub connection that repo access needs. */
export interface ConnectionTokens {
  /** A token for `owner/name`, or null when the connection does not cover it. */
  tokenFor(owner: string, name: string): Promise<string | null>;
}

export function createRepoAccess(deps: {
  db: Db;
  vault: RepoCredentialVault;
  remoteBase: string;
  connection?: ConnectionTokens;
}): RepoAccess {
  const { db, vault, remoteBase, connection } = deps;

  const pickToken = async (
    found: RepoRow,
  ): Promise<{ token: string | null; source: RepoCredential["source"] }> => {
    let failure: unknown = null;
    if (connection) {
      try {
        const token = await connection.tokenFor(found.owner, found.name);
        if (token) return { token, source: "connection" };
      } catch (err) {
        failure = err;
      }
    }
    if (found.encryptedCredential) {
      return { token: vault.open(found.id, found.encryptedCredential), source: "repo" };
    }
    if (failure) {
      const detail =
        failure instanceof GitHubApiError
          ? `${failure.detail} (${failure.status})`
          : "unexpected error";
      throw new RepoCredentialError("connection_failed", detail);
    }
    return { token: null, source: null };
  };

  const toCheckout = (row: RepoRow): RepoCheckout => ({
    repoId: row.id,
    floorId: row.floorId,
    owner: row.owner,
    name: row.name,
    workdir: row.workdir,
    defaultBranch: row.defaultBranch,
    remoteUrl: repoRemoteUrl(remoteBase, row),
    cloneStatus: row.cloneStatus,
    isPrimary: row.isPrimary,
  });

  const row = (repoId: string) =>
    db.select().from(floorRepos).where(eq(floorRepos.id, repoId)).get();

  return {
    getRepo(repoId) {
      const found = row(repoId);
      return found ? toCheckout(found) : undefined;
    },
    listFloorRepos(floorId) {
      return db
        .select()
        .from(floorRepos)
        .where(eq(floorRepos.floorId, floorId))
        .all()
        .map(toCheckout);
    },
    async withRepoCredential(repoId, fn) {
      const found = row(repoId);
      if (!found) throw new RepoNotFoundError(repoId);
      const { token, source } = await pickToken(found);
      return await fn({
        repo: toCheckout(found),
        token,
        source,
        gitEnv: gitAuthEnv(token),
        redact: (text) => redactGitOutput(text, [token]),
      });
    },
  };
}
