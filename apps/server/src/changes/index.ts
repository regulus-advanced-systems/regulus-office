/**
 * A robot's changes window (#38; SPEC §10 M2, D10): live status and diff of
 * its worktree against the merge-base, per-file diffs and image previews for
 * everyone on the floor; commit and discard for its owner (D12). Git runs in
 * the owner's runner or the robot's sandbox (robot-shell.ts).
 *
 * Boot wiring:
 *   mountChangesRoutes(server.router, {
 *     auth, db, logger,
 *     changes: new ChangesService({ db, runner, repos: floors.repos, clones: worktrees.workspaces }),
 *   });
 */
export { decideChangesAccess, mayWriteChanges } from "./acl.ts";
export { CHANGES_ROUTE, mountChangesRoutes } from "./routes.ts";
export { ChangesService, type ChangesServiceDeps } from "./service.ts";
