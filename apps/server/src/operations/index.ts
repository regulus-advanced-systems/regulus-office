/**
 * Operations (= projects) bound to GitHub repos (SPEC §5, §8, §9.1; D7, D14).
 *
 * Boot wiring:
 *   const operations = createOperations({ db, logger, config, keyring, onChange, dirs });
 *   mountOperationRoutes(server.router, { auth, operations: operations.service, lifecycle: operations.lifecycle });
 *   operations.lifecycle.henchmen = { sendHome: ... };   // once the AgentManager exists
 *   void operations.cloner.resumePending();
 * #31 uses `operations.repos.withRepoCredential(repoId, fn)` for server-side git.
 */
import type { RoomPlacer } from "../compound/service.ts";
import type { OfficeConfig } from "../config.ts";
import type { Db } from "../db/index.ts";
import { RepoCredentialVault } from "../github/credentials.ts";
import type { GitRunner } from "../github/git.ts";
import { type ConnectionTokens, createRepoAccess, type RepoAccess } from "../github/repo-access.ts";
import type { Logger } from "../logging.ts";
import type { MasterKeyring } from "../secrets/index.ts";
import {
  OfficeOperationDirRemover,
  type OperationDirRemover,
} from "../worktrees/operation-dirs.ts";
import { RepoCloner } from "./cloner.ts";
import { OperationLifecycle } from "./lifecycle.ts";
import { OperationService } from "./service.ts";

export {
  effectiveAccess,
  isOfficeManager,
  type OperationActor,
  operationAccessFor,
} from "./access.ts";
export { RepoCloner } from "./cloner.ts";
export { henchmenOn, type OperationHenchmen, OperationLifecycle } from "./lifecycle.ts";
export { mountOperationRoutes } from "./routes.ts";
export { type CreateOperationInput, OperationService } from "./service.ts";

export interface OperationsDeps {
  db: Db;
  logger: Logger;
  config: Pick<OfficeConfig, "projectsDir" | "githubRemoteBase"> &
    Partial<Pick<OfficeConfig, "worktreesDir">>;
  /** Absent when OFFICE_MASTER_KEY is unset: public repos only. */
  keyring: MasterKeyring | undefined;
  /**
   * Removes a deleted operation's dirs (worktrees/operation-dirs.ts `operationDirRemover`,
   * which picks the runner backend's way). Default: the office itself, under
   * the projects and worktrees dirs.
   */
  dirs?: OperationDirRemover;
  /** An operation was created, archived, restored or deleted, or one of its repos finished cloning. */
  onChange?(operationId: string): void;
  /** A human's access to an operation was set or removed (live access, #244). */
  onAccessChange?(operationId: string, userId: string): void;
  /** Places new operations in the compound (#181). */
  placer?: RoomPlacer;
  git?: GitRunner;
  /**
   * The office GitHub connection (#141): its token is used for repos it
   * covers; other repos use their own stored PAT.
   */
  connection?: ConnectionTokens;
}

export interface Operations {
  service: OperationService;
  /** Archive, restore, delete (#150). */
  lifecycle: OperationLifecycle;
  cloner: RepoCloner;
  /** Server-side git seam: workdir, default branch, decrypted PAT for one callback. */
  repos: RepoAccess;
}

export function createOperations(deps: OperationsDeps): Operations {
  const vault = new RepoCredentialVault(deps.keyring);
  const repos = createRepoAccess({
    db: deps.db,
    vault,
    remoteBase: deps.config.githubRemoteBase,
    connection: deps.connection,
  });
  const cloner = new RepoCloner({
    db: deps.db,
    repos,
    git: deps.git,
    logger: deps.logger.child({ module: "operations" }),
    onSettled: (operationId) => deps.onChange?.(operationId),
  });
  const service = new OperationService({
    db: deps.db,
    vault,
    cloner,
    projectsDir: deps.config.projectsDir,
    onChange: deps.onChange,
    onAccessChange: deps.onAccessChange,
    placer: deps.placer,
  });
  const roots = [deps.config.projectsDir, deps.config.worktreesDir].filter(
    (d): d is string => typeof d === "string",
  );
  const lifecycle = new OperationLifecycle({
    db: deps.db,
    logger: deps.logger.child({ module: "operations" }),
    dirs: deps.dirs ?? new OfficeOperationDirRemover(roots),
    onChange: deps.onChange,
  });
  return { service, lifecycle, cloner, repos };
}
