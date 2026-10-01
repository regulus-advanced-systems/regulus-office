/**
 * An operation's directory below a root, `<root>/<slug>`, checked before anything
 * removes it (#150): the slug is an operation slug (one path segment, no dots),
 * the root is resolved once, and the target must be a real, canonical
 * directory, never a symlink. Shared by the office-side remover
 * (worktrees/operation-dirs.ts) and the docker runner's cleanup (docker/operation-cleanup.ts).
 */
import { lstat, realpath } from "node:fs/promises";
import { join } from "node:path";
import { OPERATION_SLUG } from "./layout.ts";

export class OperationDirsError extends Error {
  override name = "OperationDirsError";
}

export function checkOperationSlug(slug: string): string {
  if (!OPERATION_SLUG.test(slug)) throw new OperationDirsError("invalid operation slug");
  return slug;
}

const errno = (err: unknown) => (err as NodeJS.ErrnoException | undefined)?.code;

/** `<root>/<slug>` when it is a real directory directly below the resolved root, else null. */
export async function operationDirUnder(root: string, slug: string): Promise<string | null> {
  checkOperationSlug(slug);
  let base: string;
  try {
    base = await realpath(root);
  } catch (err) {
    if (errno(err) === "ENOENT") return null;
    throw err;
  }
  const target = join(base, slug);
  let info: Awaited<ReturnType<typeof lstat>>;
  try {
    info = await lstat(target);
  } catch (err) {
    if (errno(err) === "ENOENT") return null;
    throw err;
  }
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new OperationDirsError(`${target} is not a directory; refusing to remove it`);
  }
  if ((await realpath(target)) !== target) {
    throw new OperationDirsError(`${target} is not canonical; refusing to remove it`);
  }
  return target;
}
