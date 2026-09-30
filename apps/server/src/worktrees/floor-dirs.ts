/**
 * Removing a deleted floor's files (#150): the floor mirror dir
 * `<projects>/<slug>` and the floor dir `<worktrees>/<slug>`, which holds every
 * human's area (their clones and agent worktrees; ../runners/layout.ts).
 *
 * Nothing else is ever removed:
 * - the slug must be a floor slug (`[a-z0-9-]`, no dots, no slashes), so the
 *   target is always exactly one level below a configured root;
 * - the root is resolved once (an operator may point it through a symlink),
 *   and the target below it must be a real directory, not a symlink;
 * - the tree is removed without following symlinks: GNU `rm -r
 *   --one-file-system` walks it with openat/O_NOFOLLOW (safe against a
 *   symlink swapped in while it runs); elsewhere (dev on macOS) `fs.rm`,
 *   which unlinks symlinks instead of following them.
 *
 * Backends:
 * - linux-user: files in humans' areas belong to their runner accounts, so the
 *   privileged helper's `remove-floor <slug>` verb does it (same checks, as root).
 * - docker: the humans' areas are first removed as the runner uid (in the
 *   human's running runner, else a janitor container; docker/floor-cleanup.ts),
 *   since agents' files belong to it. Then the office removes the rest as
 *   itself, and the runners drop their mounts of the removed areas once idle
 *   (`reconcileMounts`).
 * - local: the office removes everything as its own user.
 */
import { rm } from "node:fs/promises";
import type { Logger } from "../logging.ts";
import { checkFloorSlug, FloorDirsError, floorDirUnder } from "../runners/floor-dir.ts";
import type { RunnerHandle, RunnerUser } from "../runners/types.ts";

export { checkFloorSlug, FloorDirsError, floorDirUnder } from "../runners/floor-dir.ts";

export interface FloorDirRemover {
  /** Remove the floor's dirs under the projects and worktrees roots; returns what was removed. */
  removeFloorDirs(slug: string): Promise<string[]>;
}

type RemoveTree = (dir: string) => Promise<void>;

/** GNU rm on Linux (race-safe against symlink swaps); `fs.rm` elsewhere. */
export const removeTree: RemoveTree = async (dir) => {
  if (process.platform !== "linux") {
    await rm(dir, { recursive: true, force: true });
    return;
  }
  const proc = Bun.spawn(["rm", "-r", "-f", "--one-file-system", "--", dir], {
    stdin: "ignore",
    stdout: "ignore",
    stderr: "pipe",
    env: { PATH: "/usr/bin:/bin", LC_ALL: "C" },
  });
  const [stderr, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
  if (code !== 0) {
    const first = stderr.trim().split("\n").slice(0, 3).join("; ");
    throw new FloorDirsError(`could not remove ${dir}: ${first.slice(0, 500)}`);
  }
};

/** The office removes the dirs as its own user (docker, local). */
export class OfficeFloorDirRemover implements FloorDirRemover {
  readonly #roots: readonly string[];
  readonly #remove: RemoveTree;

  constructor(roots: readonly string[], remove: RemoveTree = removeTree) {
    this.#roots = roots;
    this.#remove = remove;
  }

  async removeFloorDirs(slug: string): Promise<string[]> {
    checkFloorSlug(slug);
    const removed: string[] = [];
    for (const root of this.#roots) {
      const dir = await floorDirUnder(root, slug);
      if (!dir) continue;
      await this.#remove(dir);
      removed.push(dir);
    }
    return removed;
  }
}

interface HelperRemoves {
  removeFloorDirs(slug: string): Promise<string[]>;
}
interface Remounts {
  removeFloorAreas(slug: string): Promise<void>;
  recover(): Promise<RunnerHandle[]>;
  reconcileMounts(user: RunnerUser): Promise<boolean>;
}

export interface FloorDirsDeps {
  projectsDir: string;
  worktreesDir: string;
  runner: object;
  logger: Logger;
}

/**
 * The remover for the configured runner backend: the linux-user helper when
 * the runner has it; docker: the runner uid's cleanup, then the office, then a
 * mount reconcile of every runner in the background; else the office itself.
 */
export function floorDirRemover(deps: FloorDirsDeps): FloorDirRemover {
  const { runner, logger } = deps;
  if ("removeFloorDirs" in runner) return runner as HelperRemoves;
  const office = new OfficeFloorDirRemover([deps.projectsDir, deps.worktreesDir]);
  if (!("removeFloorAreas" in runner && "reconcileMounts" in runner)) return office;
  const docker = runner as Remounts;
  return {
    async removeFloorDirs(slug) {
      checkFloorSlug(slug);
      try {
        await docker.removeFloorAreas(slug);
      } catch (err) {
        // E.g. no runner image for the janitor. The office's own rm below still
        // removes what it can, and fails the delete if anything is left.
        const reason = err instanceof Error ? err.message : String(err);
        logger.warn({ slug, err: reason.slice(0, 500) }, "runner-side floor cleanup failed");
      }
      const removed = await office.removeFloorDirs(slug);
      void reconcileAll(docker).catch((err) =>
        logger.warn({ err: String(err) }, "runner mounts not reconciled after a floor delete"),
      );
      return removed;
    },
  };
}

/** Idle runners drop mounts of removed areas now; busy ones on their next change. */
async function reconcileAll(docker: Remounts): Promise<void> {
  for (const handle of await docker.recover()) {
    await docker.reconcileMounts({ userId: handle.userId });
  }
}
