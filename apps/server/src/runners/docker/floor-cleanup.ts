/**
 * Removing a deleted floor's human areas as the runner uid (#150). Files that
 * agents created in `<root>/<slug>/<rid>` belong to the runner uid, and a
 * directory they made without group write cannot be emptied by the office
 * (which is only in the runners' group). So, before the office removes what is
 * left as itself:
 *
 * - an area mounted in its human's running runner is emptied by an exec of
 *   `find <area> -xdev -mindepth 1 -delete` in that runner (same path inside);
 * - anything still there is removed by a short-lived janitor container: the
 *   runner image as the runner uid, no network, every capability dropped,
 *   no-new-privileges, only that floor's dir mounted, labelled, removed after
 *   it exits.
 *
 * Every path is checked on the office side first (runners/floor-dir.ts: floor
 * slug, canonical, not a symlink). The janitor's mount goes through the same
 * volume map / bind rules as runner mounts (mounts.ts `toMountSpec`), so it
 * stays within the socket proxy's bind root. `find -delete` never follows
 * symlinks (-P, depth-first) and stays on one file system (-xdev). What the
 * runner uid cannot remove (the area dirs themselves, office-made dirs) the
 * office removes afterwards; its `rm` failing is what fails the delete.
 */
import { randomUUID } from "node:crypto";
import { lstat, readdir } from "node:fs/promises";
import { join, normalize } from "node:path";
import { checkFloorSlug, FloorDirsError, floorDirUnder } from "../floor-dir.ts";
import {
  type ContainerSettings,
  LABEL_PREFIX,
  LABEL_ROLE,
  LABEL_USER,
  type RunnerContainers,
} from "./containers.ts";
import { DockerApiError, type EngineClient } from "./engine.ts";
import { isImageMissing, pullImage } from "./image.ts";
import { type MountSpec, toMountSpec, type VolumeMapping } from "./mounts.ts";

export const JANITOR_ROLE = "janitor";
/** `find <areas...> ${EMPTY}`: empty each area, as the uid it runs as. */
const EMPTY = ["-xdev", "-mindepth", "1", "-delete"] as const;
/** A janitor that runs longer than this is stopped and removed. */
const JANITOR_TIMEOUT_MS = 10 * 60_000;

export interface FloorCleanupDeps {
  engine: EngineClient;
  containers: RunnerContainers;
  settings: ContainerSettings;
  floorRoots: readonly string[];
  volumeMap: readonly VolumeMapping[];
}

async function areasIn(floorDir: string): Promise<string[]> {
  const entries = await readdir(floorDir, { withFileTypes: true }).catch(() => []);
  const areas: string[] = [];
  for (const e of entries) {
    const path = join(floorDir, e.name);
    // Only real directories; a symlink (or a file) is left for the office's own rm.
    const info = await lstat(path).catch(() => null);
    if (info?.isDirectory() && !info.isSymbolicLink()) areas.push(path);
  }
  return areas.sort();
}

/** Gone or empty: nothing left for the runner uid to remove. */
async function isEmpty(dir: string): Promise<boolean> {
  const entries = await readdir(dir).catch(() => []);
  return entries.length === 0;
}

/** The floor dir below `root`, only when the office sees it at the configured path. */
async function checkedFloorDir(root: string, slug: string): Promise<string | null> {
  const dir = await floorDirUnder(root, slug);
  if (dir && dir !== join(normalize(root), slug)) {
    // Runners see the configured path; a root behind a symlink would not match their mounts.
    throw new FloorDirsError(`floor root ${root} must be canonical for runner cleanup`);
  }
  return dir;
}

/** Remove the human areas of floor `slug` under every floor root, as the runner uid. */
export async function removeFloorAreas(deps: FloorCleanupDeps, slug: string): Promise<void> {
  checkFloorSlug(slug);
  for (const root of deps.floorRoots) {
    const floorDir = await checkedFloorDir(root, slug);
    if (!floorDir) continue;
    const areas = await areasIn(floorDir);
    if (areas.length === 0) continue;
    await removeInRunners(deps, areas);
    const left: string[] = [];
    for (const area of areas) if (!(await isEmpty(area))) left.push(area);
    if (left.length > 0) await runJanitor(deps, floorDir, left);
  }
}

/** Areas mounted in a running runner: `rm` inside it, as its user. */
async function removeInRunners(deps: FloorCleanupDeps, areas: readonly string[]): Promise<void> {
  const rows = await deps.engine.json<{ Labels: Record<string, string> }[]>(
    "GET",
    "/containers/json",
    {
      query: {
        filters: JSON.stringify({
          label: [`${LABEL_ROLE}=runner`, `${LABEL_PREFIX}=${deps.settings.prefix}`],
        }),
      },
    },
  );
  for (const row of rows) {
    const userId = row.Labels[LABEL_USER];
    if (!userId) continue;
    const c = await deps.containers.lookup(userId).catch(() => null);
    if (!c?.running) continue;
    const mine = areas.filter((a) => c.floorMounts.some((m) => normalize(m.Target) === a));
    if (mine.length === 0) continue;
    // Failures are fine here: the janitor and then the office take what is left.
    await deps.engine.exec(c.id, { cmd: ["find", ...mine, ...EMPTY] }).catch(() => undefined);
  }
}

/** A throwaway container as the runner uid with only `floorDir` mounted. */
async function runJanitor(
  deps: FloorCleanupDeps,
  floorDir: string,
  areas: readonly string[],
): Promise<number> {
  const s = deps.settings;
  const mount: MountSpec = toMountSpec(floorDir, deps.volumeMap);
  const body = {
    Image: s.image,
    User: s.user,
    Entrypoint: ["find"],
    Cmd: [...areas, ...EMPTY],
    Env: ["IS_SANDBOX=1"],
    WorkingDir: "/",
    Labels: { ...s.labels, [LABEL_ROLE]: JANITOR_ROLE, [LABEL_PREFIX]: s.prefix },
    NetworkDisabled: true,
    HostConfig: {
      Mounts: [mount],
      NetworkMode: "none",
      CapDrop: ["ALL"],
      SecurityOpt: ["no-new-privileges"],
      ReadonlyRootfs: true,
      PidsLimit: 64,
    },
  };
  const name = `${s.prefix}-janitor-${randomUUID().slice(0, 8)}`;
  const create = () =>
    deps.engine.json<{ Id: string }>("POST", "/containers/create", {
      query: { name },
      json: body,
    });
  let id: string;
  try {
    id = (await create()).Id;
  } catch (e) {
    if (!isImageMissing(e) || s.pull === false) throw e;
    await pullImage(deps.engine, s.image);
    id = (await create()).Id;
  }
  try {
    await deps.engine.call("POST", `/containers/${id}/start`);
    const { StatusCode } = await deps.engine.json<{ StatusCode: number }>(
      "POST",
      `/containers/${id}/wait`,
      { signal: AbortSignal.timeout(JANITOR_TIMEOUT_MS) },
    );
    // Non-zero is expected for office-owned entries; the office's own rm decides.
    return StatusCode;
  } finally {
    await deps.engine.call("DELETE", `/containers/${id}`, { query: { force: true } }).catch((e) => {
      if (!(e instanceof DockerApiError && e.status === 404)) throw e;
    });
  }
}
