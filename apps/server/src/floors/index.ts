/**
 * Floors (= projects) bound to GitHub repos (SPEC §5, §8, §9.1; D7, D14).
 *
 * Boot wiring:
 *   const floors = createFloors({ db, logger, config, keyring, onChange });
 *   mountFloorRoutes(server.router, { auth, floors: floors.service });
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
import { RepoCloner } from "./cloner.ts";
import { FloorService } from "./service.ts";

export { effectiveAccess, type FloorActor, floorAccessFor, isOfficeManager } from "./access.ts";
export { RepoCloner } from "./cloner.ts";
export { mountFloorRoutes } from "./routes.ts";
export { type CreateFloorInput, FloorService } from "./service.ts";

export interface FloorsDeps {
  db: Db;
  logger: Logger;
  config: Pick<OfficeConfig, "projectsDir" | "githubRemoteBase">;
  /** Absent when OFFICE_MASTER_KEY is unset: public repos only. */
  keyring: MasterKeyring | undefined;
  /** A floor was created or archived, or one of its repos finished cloning. */
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
  return { service, cloner, repos };
}
