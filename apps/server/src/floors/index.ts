/**
 * Floors (= projects) bound to GitHub repos (SPEC §5, §8, §9.1; D7, D14).
 *
 * Boot wiring:
 *   const floors = createFloors({ db, logger, config, keyring, onChange, dirs });
 *   mountFloorRoutes(server.router, { auth, floors: floors.service, lifecycle: floors.lifecycle });
 *   floors.lifecycle.robots = { sendHome: ... };   // once the AgentManager exists
 *   void floors.cloner.resumePending();
 * #31 uses `floors.repos.withRepoCredential(repoId, fn)` for server-side git.
 */
import type { OfficeConfig } from "../config.ts";
import type { Db } from "../db/index.ts";
import { RepoCredentialVault } from "../github/credentials.ts";
import type { GitRunner } from "../github/git.ts";
import { type ConnectionTokens, createRepoAccess, type RepoAccess } from "../github/repo-access.ts";
import type { Logger } from "../logging.ts";
import type { MasterKeyring } from "../secrets/index.ts";
import { type FloorDirRemover, OfficeFloorDirRemover } from "../worktrees/floor-dirs.ts";
import { RepoCloner } from "./cloner.ts";
import { FloorLifecycle } from "./lifecycle.ts";
import { FloorService } from "./service.ts";

export { effectiveAccess, type FloorActor, floorAccessFor, isOfficeManager } from "./access.ts";
export { RepoCloner } from "./cloner.ts";
export { FloorLifecycle, type FloorRobots, robotsOn } from "./lifecycle.ts";
export { mountFloorRoutes } from "./routes.ts";
export { type CreateFloorInput, FloorService } from "./service.ts";

export interface FloorsDeps {
  db: Db;
  logger: Logger;
  config: Pick<OfficeConfig, "projectsDir" | "githubRemoteBase"> &
    Partial<Pick<OfficeConfig, "worktreesDir">>;
  /** Absent when OFFICE_MASTER_KEY is unset: public repos only. */
  keyring: MasterKeyring | undefined;
  /**
   * Removes a deleted floor's dirs (worktrees/floor-dirs.ts `floorDirRemover`,
   * which picks the runner backend's way). Default: the office itself, under
   * the projects and worktrees dirs.
   */
  dirs?: FloorDirRemover;
  /** A floor was created, archived, restored or deleted, or one of its repos finished cloning. */
  onChange?(floorId: string): void;
  git?: GitRunner;
  /**
   * The office GitHub connection (#141): its token is used for repos it
   * covers; other repos use their own stored PAT.
   */
  connection?: ConnectionTokens;
}

export interface Floors {
  service: FloorService;
  /** Archive, restore, delete (#150). */
  lifecycle: FloorLifecycle;
  cloner: RepoCloner;
  /** Server-side git seam: workdir, default branch, decrypted PAT for one callback. */
  repos: RepoAccess;
}

export function createFloors(deps: FloorsDeps): Floors {
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
    logger: deps.logger.child({ module: "floors" }),
    onSettled: (floorId) => deps.onChange?.(floorId),
  });
  const service = new FloorService({
    db: deps.db,
    vault,
    cloner,
    projectsDir: deps.config.projectsDir,
    onChange: deps.onChange,
  });
  const roots = [deps.config.projectsDir, deps.config.worktreesDir].filter(
    (d): d is string => typeof d === "string",
  );
  const lifecycle = new FloorLifecycle({
    db: deps.db,
    logger: deps.logger.child({ module: "floors" }),
    dirs: deps.dirs ?? new OfficeFloorDirRemover(roots),
    onChange: deps.onChange,
  });
  return { service, lifecycle, cloner, repos };
}
