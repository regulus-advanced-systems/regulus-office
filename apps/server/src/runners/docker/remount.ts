/**
 * Mount changes of a human's runner (see `DockerRunner.mountProject`): keep
 * the human's own areas, drop anything else, add the missing ones, and
 * recreate the container for it only while it is idle (no tmux sessions, no
 * piped processes once they had time to drain; piped-tracker.ts).
 */
import { mkdir } from "node:fs/promises";
import type { RunnerUser } from "../types.ts";
import {
  isOwnArea,
  type MountSpec,
  RunnerBusyError,
  toMountSpec,
  type VolumeMapping,
} from "./mounts.ts";
import type { PipedTracker } from "./piped-tracker.ts";

export interface RemountDeps {
  floorRoots: readonly string[];
  volumeMap: readonly VolumeMapping[];
  piped: PipedTracker;
  listSessions: (user: RunnerUser) => Promise<string[]>;
  recreate: (userId: string, mounts: MountSpec[]) => Promise<void>;
}

/**
 * `running`: false for a stopped container (nothing runs in it). `strict`:
 * throw {@link RunnerBusyError} when busy, else return false.
 */
export async function remount(
  deps: RemountDeps,
  user: RunnerUser,
  current: readonly MountSpec[],
  missing: readonly string[],
  opts: { running: boolean; strict: boolean },
): Promise<boolean> {
  const keep = current.filter((m) => isOwnArea(m, deps.floorRoots, user.userId));
  const stale = current.filter((m) => !keep.includes(m)).map((m) => m.Target);
  if (missing.length === 0 && stale.length === 0) return true;

  const list = () => (opts.running ? deps.listSessions(user) : Promise.resolve([]));
  const { sessions, piped } = await deps.piped.busy(user.userId, list, opts.strict);
  if (sessions.length > 0 || piped.length > 0) {
    if (!opts.strict) return false;
    const changes = [...missing, ...stale.map((t) => `-${t}`)];
    throw new RunnerBusyError(user.userId, sessions, changes, piped);
  }
  // Mount sources must exist: create them as the office sees them (bind or volume subpath).
  for (const dir of missing) await mkdir(dir, { recursive: true }).catch(() => {});
  await deps.recreate(user.userId, [
    ...keep,
    ...missing.map((t) => toMountSpec(t, deps.volumeMap)),
  ]);
  return true;
}
