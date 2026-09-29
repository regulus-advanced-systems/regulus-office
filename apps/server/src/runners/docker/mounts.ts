/**
 * Which host directory a runner container needs for a workdir, and how to
 * express it as an Engine API mount.
 *
 * Mount unit: the human's own area on a floor, `<root>/<floor>/<rid>` (see
 * ../layout.ts), never a whole floor dir. It holds that human's clones and
 * worktrees, so later repos and worktrees on the same floor need no new mount
 * (and no container recreate), and nothing of another human or the office's
 * mirrors is ever visible in the runner (#114). Paths are the same inside the
 * runner as in the office, so `SpawnPlan.cwd` needs no mapping.
 *
 * Sources: a path under a `volumeMap` entry (the office itself runs in Compose
 * with the worktrees dir in a named volume) becomes a volume mount with
 * `Subpath`; anything else is a bind mount of the same host path (bare-metal
 * office talking to a local daemon).
 */
import { isAbsolute, normalize, relative } from "node:path";
import { humanAreaOf } from "../layout.ts";

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

/** Thrown when a workdir is outside the human's own area (nothing else is ever mounted). */
export class MountRefusedError extends Error {
  override name = "MountRefusedError";
}

/** The human area to mount so `workdir` is reachable; refuses anything else. */
export function humanMountTarget(
  workdir: string,
  roots: readonly string[],
  userId: string,
): string {
  const dir = checkPath(workdir);
  for (const root of roots.map(checkPath)) {
    const area = humanAreaOf(dir, root, userId);
    if (area) return area;
  }
  throw new MountRefusedError(
    `refusing to mount ${dir}: runners only get their own <root>/<floor>/<runner id> dir`,
  );
}

/** A mount a runner may keep: exactly one of this human's areas under a root. */
export function isOwnArea(mount: MountSpec, roots: readonly string[], userId: string): boolean {
  const target = checkPath(mount.Target);
  return roots.some((root) => humanAreaOf(target, checkPath(root), userId) === target);
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

/**
 * `mountProject` needs a new mount but the runner has live work that a recreate
 * would kill: tmux sessions (agents, login sessions) and piped side processes
 * (login checks, `codex app-server`) that did not finish within the drain bound.
 */
export class RunnerBusyError extends Error {
  override name = "RunnerBusyError";
  constructor(
    readonly userId: string,
    readonly sessions: readonly string[],
    readonly missing: readonly string[],
    /** Short labels (program and subcommand) of piped processes still running. */
    readonly piped: readonly string[] = [],
  ) {
    super(
      `runner for ${userId} needs its mounts changed (${missing.join(", ")}) but is busy: ` +
        busyParts(sessions, piped).join("; ") +
        "; stop its agents first",
    );
  }
}

function busyParts(sessions: readonly string[], piped: readonly string[]): string[] {
  const list = (items: readonly string[]) => (items.length ? ` (${items.join(", ")})` : "");
  const parts: string[] = [];
  if (sessions.length) parts.push(`${sessions.length} tmux session(s)${list(sessions)}`);
  if (piped.length) parts.push(`${piped.length} piped process(es) still running${list(piped)}`);
  return parts;
}

/** Default mount root: the worktrees dir, which holds every human's area (../layout.ts). */
export const DEFAULT_FLOOR_ROOTS = ["/srv/office/worktrees"] as const;
