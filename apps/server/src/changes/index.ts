/**
 * A henchman's changes window (#38; SPEC §10 M2, D10): live status and diff of
 * its worktree against the merge-base, per-file diffs and image previews for
 * everyone on the operation; commit and discard for its owner (D12). Git runs in
 * the owner's runner or the henchman's sandbox (henchman-shell.ts).
 *
 * Boot wiring:
 *   mountChangesRoutes(server.router, {
 *     auth, db, logger,
 *     changes: new ChangesService({ db, runner, repos: operations.repos, clones: worktrees.workspaces }),
 *   });
 */
export { decideChangesAccess, mayWriteChanges } from "./acl.ts";
export { CHANGES_ROUTE, mountChangesRoutes } from "./routes.ts";
export { ChangesService, type ChangesServiceDeps } from "./service.ts";
