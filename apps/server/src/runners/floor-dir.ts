/**
 * A floor's directory below a root, `<root>/<slug>`, checked before anything
 * removes it (#150): the slug is a floor slug (one path segment, no dots),
 * the root is resolved once, and the target must be a real, canonical
 * directory, never a symlink. Shared by the office-side remover
 * (worktrees/floor-dirs.ts) and the docker runner's cleanup (docker/floor-cleanup.ts).
 */
import { lstat, realpath } from "node:fs/promises";
import { join } from "node:path";
import { FLOOR_SLUG } from "./layout.ts";

export class FloorDirsError extends Error {
  override name = "FloorDirsError";
}

export function checkFloorSlug(slug: string): string {
  if (!FLOOR_SLUG.test(slug)) throw new FloorDirsError("invalid floor slug");
  return slug;
}

const errno = (err: unknown) => (err as NodeJS.ErrnoException | undefined)?.code;

/** `<root>/<slug>` when it is a real directory directly below the resolved root, else null. */
export async function floorDirUnder(root: string, slug: string): Promise<string | null> {
  checkFloorSlug(slug);
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
    throw new FloorDirsError(`${target} is not a directory; refusing to remove it`);
  }
  if ((await realpath(target)) !== target) {
    throw new FloorDirsError(`${target} is not canonical; refusing to remove it`);
  }
  return target;
}
