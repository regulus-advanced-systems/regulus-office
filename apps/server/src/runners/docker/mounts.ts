/**
 * Which host directories a runner container needs for a floor repo, and how to
 * express them as Engine API mounts.
 *
 * Mount unit: a whole floor directory, not a single repo. For a workdir
 * `<root>/<floor>/<repo>` under one of the configured floor roots (default
 * `/srv/office/projects` and `/srv/office/worktrees`, SPEC §8), the runner gets
 * `<root>/<floor>` for every root, so later repos and per-agent worktrees on
 * the same floor need no new mount (and no container recreate). Paths are the
 * same inside the runner as in the office, so `SpawnPlan.cwd` needs no mapping.
 *
 * Sources: a path under a `volumeMap` entry (the office itself runs in Compose
 * with the projects dir in a named volume) becomes a volume mount with
 * `Subpath`; anything else is a bind mount of the same host path (bare-metal
 * office talking to a local daemon).
 */
import { isAbsolute, normalize, relative, sep } from "node:path";

export interface VolumeMapping {
  /** Directory as the office sees it, e.g. `/srv/office/projects`. */
  path: string;
  /** Named volume holding that directory, e.g. `regulus_projects`. */
  volume: string;
}

/** Engine API `HostConfig.Mounts` entry (the subset used here). */
export interface MountSpec {
  Type: "bind" | "volume" | "tmpfs";
  Source?: string;
  Target: string;
  ReadOnly?: boolean;
  VolumeOptions?: { Subpath?: string; Labels?: Record<string, string> };
}

function inside(child: string, parent: string): boolean {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function checkPath(path: string): string {
  if (!isAbsolute(path)) throw new Error(`runner mount path must be absolute: ${path}`);
  const clean = normalize(path).replace(/\/+$/, "");
  return clean === "" ? "/" : clean;
}

/** Directories to mount so `workdir` (on the given floor) is reachable. */
export function floorMountTargets(workdir: string, floorRoots: readonly string[]): string[] {
  const dir = checkPath(workdir);
  for (const root of floorRoots.map(checkPath)) {
    if (!inside(dir, root) || dir === root) continue;
    const floorDir = relative(root, dir).split(sep)[0] ?? "";
    return [...new Set(floorRoots.map((r) => `${checkPath(r)}/${floorDir}`))];
  }
  return [dir];
}

/** True when some existing mount's target is `target` or one of its parents. */
export function isCovered(target: string, mounts: readonly MountSpec[]): boolean {
  return mounts.some((m) => inside(target, m.Target));
}

export function toMountSpec(target: string, volumeMap: readonly VolumeMapping[]): MountSpec {
  const dir = checkPath(target);
  for (const { path, volume } of volumeMap) {
    const base = checkPath(path);
    if (!inside(dir, base)) continue;
    const sub = relative(base, dir);
    return {
      Type: "volume",
      Source: volume,
      Target: dir,
      ...(sub ? { VolumeOptions: { Subpath: sub } } : {}),
    };
  }
  return { Type: "bind", Source: dir, Target: dir };
}
