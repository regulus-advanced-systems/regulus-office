/**
 * Where a human's git work lives on an operation (#114; SPEC §8 as amended by the
 * owner's decision in #114: one clone per human per operation repo).
 *
 *   <projects>/<operation>/<repo>                    office-only mirror; no runner can reach it
 *   <worktrees>/<operation>/<rid>/                   the human's area: the only operation directory
 *                                                their runner is given (mount or ACL)
 *   <worktrees>/<operation>/<rid>/_clones/<repo>     the human's own clone of each operation repo
 *   <worktrees>/<operation>/<rid>/<agentId>          per-agent worktrees of that clone
 *
 * `<rid>` is the human's runner id (`runnerId`, also the linux-user account
 * suffix). One directory per human per operation holds everything their agents
 * may touch, so the docker backend mounts exactly one directory per operation and
 * the linux-user backend puts ACLs on nothing outside it. The projects root
 * holds only mirrors and gets no runner access at all, not even traverse.
 * Agent ids are UUIDs, so they never clash with `_clones`.
 */
import { isAbsolute, join, normalize, relative, sep } from "node:path";
import { RUNNER_ID, runnerId } from "./linux-user/ids.ts";

export { runnerId };

/**
 * An operation slug as `operations/naming.ts` makes it: the one path segment below a
 * root that names an operation. No dots or slashes, so `<root>/<slug>` is always
 * exactly one level below the root (#150 removes such dirs).
 */
export const OPERATION_SLUG = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

/** Directory inside a human's area that holds their clones. */
export const CLONES_DIR = "_clones";

/** `<worktreesRoot>/<operation>/<rid>`: the one operation directory the human's runner may use. */
export function humanAreaDir(worktreesRoot: string, operationSlug: string, userId: string): string {
  return join(worktreesRoot, operationSlug, runnerId(userId));
}

/** `<area>/_clones/<repoDir>`: the human's own clone of an operation repo. */
export function humanClonePath(
  worktreesRoot: string,
  operationSlug: string,
  userId: string,
  repoDir: string,
): string {
  return join(humanAreaDir(worktreesRoot, operationSlug, userId), CLONES_DIR, repoDir);
}

/** `<area>/<agentId>`: an agent's worktree of its owner's clone. */
export function agentWorktreePath(
  worktreesRoot: string,
  operationSlug: string,
  userId: string,
  agentId: string,
): string {
  return join(humanAreaDir(worktreesRoot, operationSlug, userId), agentId);
}

/**
 * The human area of `userId` that contains `path` under `root`
 * (`<root>/<operation>/<rid>`), or null when `path` is anywhere else: the root,
 * an operation dir, a mirror, another human's area.
 */
export function humanAreaOf(path: string, root: string, userId: string): string | null {
  if (!isAbsolute(path) || !isAbsolute(root)) return null;
  const rel = relative(normalize(root), normalize(path));
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) return null;
  const [operation, rid] = rel.split(sep);
  if (!operation || operation.startsWith(".") || !rid || !RUNNER_ID.test(rid)) return null;
  if (rid !== runnerId(userId)) return null;
  return join(normalize(root), operation, rid);
}
