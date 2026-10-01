/**
 * Path checks for the changes window (#38). A path from a client must be a
 * plain relative path inside the henchman's worktree:
 *
 * - lexically: not empty, no NUL, not absolute, no empty, `.` or `..`
 *   segment, nothing under `.git` (the henchman's repository metadata);
 * - and, for commit, discard and diff, one of the files git itself reported
 *   in the current snapshot (checked by the caller), so git has already
 *   refused anything beyond a symlinked directory;
 * - before the office reads a working-tree file's bytes (image previews,
 *   untracked diffs), `realpath` in the henchman's runner must resolve it to
 *   exactly `<worktree>/<path>`: no component is a symlink, so a link to the
 *   owner's HOME (their CLI logins) can never be shown to watchers.
 */
import type { ChangesError } from "@regulus/protocol";

export class ChangesHttpError extends Error {
  override name = "ChangesHttpError";
  constructor(
    readonly status: number,
    readonly code: ChangesError,
    message: string = code,
    readonly files: readonly string[] = [],
  ) {
    super(message);
  }

  toJSON() {
    return {
      error: this.code,
      message: this.message,
      ...(this.files.length > 0 ? { files: this.files } : {}),
    };
  }
}

export const invalidPath = (why: string) => new ChangesHttpError(400, "invalid_path", why);

export const MAX_PATH_LENGTH = 4096;

/** The lexical check; returns the path unchanged or throws `invalid_path`. */
export function checkRepoPath(path: unknown): string {
  if (typeof path !== "string" || path.length === 0) throw invalidPath("path is required");
  if (path.length > MAX_PATH_LENGTH) throw invalidPath("path is too long");
  if (path.includes("\0")) throw invalidPath("path contains NUL");
  if (path.startsWith("/")) throw invalidPath("path must be relative to the worktree");
  for (const segment of path.split("/")) {
    if (segment === "" || segment === "." || segment === "..") {
      throw invalidPath("path must not contain empty, '.' or '..' segments");
    }
    if (segment.toLowerCase() === ".git") throw invalidPath("path must not be inside .git");
  }
  return path;
}

/**
 * Whether `realpath -e -z -- . <path>` output (run in the worktree) shows
 * `path` resolving to itself under the worktree, with no symlink anywhere.
 */
export function resolvesInside(realpathOut: string, path: string): boolean {
  const [root, resolved] = realpathOut.split("\0");
  if (!root || !resolved || !root.startsWith("/")) return false;
  const expected = root === "/" ? `/${path}` : `${root}/${path}`;
  return resolved === expected;
}
