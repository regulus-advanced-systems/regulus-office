/**
 * Boot-time migration from the shared floor clone (before #114) to one clone
 * per human. Runs after the AgentManager re-adopted agents: agents whose
 * workspace is still in the old layout are stopped and marked offline there
 * (adopt.ts), so nothing runs in the old layout any more.
 *
 * - docker: runner containers created with whole-floor mounts are recreated
 *   with only their human's own areas once idle (every boot; cheap). A busy
 *   runner keeps them until its next `mountProject`, which refuses to start
 *   anything in it while they are there.
 * - linux-user: `reclaim` the projects root (every mirror) and each pre-#114
 *   per-agent worktree, so no runner account keeps an ACL on or owns a file in
 *   them. Done once, then `<projects>/.office-layout` records it; a failure
 *   (e.g. an old helper without `reclaim`) is logged and retried next boot.
 */
import { readdir, realpath, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Logger } from "../logging.ts";
import { RUNNER_ID } from "../runners/linux-user/ids.ts";
import type { RunnerHandle, RunnerUser } from "../runners/types.ts";

export const LAYOUT_MARKER = ".office-layout";
const LAYOUT = "per-human-clones\n";

interface Reclaims {
  reclaim(dir: string): Promise<void>;
}
interface Remounts {
  recover(): Promise<RunnerHandle[]>;
  reconcileMounts(user: RunnerUser): Promise<boolean>;
}

export interface LegacyLayoutDeps {
  projectsDir: string;
  worktreesDir: string;
  runner: object;
  logger: Logger;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function subdirs(path: string): Promise<string[]> {
  try {
    const entries = await readdir(path, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory() && !e.name.startsWith(".")).map((e) => e.name);
  } catch {
    return [];
  }
}

/** Pre-#114 per-agent worktrees: `<worktrees>/<floor>/<agentId>`, not a human's area. */
export async function legacyWorktreeDirs(worktreesDir: string): Promise<string[]> {
  const found: string[] = [];
  for (const floor of await subdirs(worktreesDir)) {
    for (const name of await subdirs(join(worktreesDir, floor))) {
      const path = join(worktreesDir, floor, name);
      if (!RUNNER_ID.test(name) || (await exists(join(path, ".git")))) found.push(path);
    }
  }
  return found;
}

export async function migrateLegacyLayout(deps: LegacyLayoutDeps): Promise<void> {
  const { runner, logger } = deps;
  const log = logger.child({ module: "layout-migration" });

  if ("reconcileMounts" in runner && "recover" in runner) {
    const docker = runner as Remounts;
    for (const handle of await docker.recover()) {
      const done = await docker.reconcileMounts({ userId: handle.userId });
      if (!done) {
        log.warn(
          { userId: handle.userId },
          "runner still has whole-floor mounts from before per-human clones and is busy; " +
            "it gets no new agents until they stop",
        );
      }
    }
  }

  if (!("reclaim" in runner)) return;
  const marker = join(deps.projectsDir, LAYOUT_MARKER);
  if (await exists(marker)) return;
  const dirs = [
    ...((await exists(deps.projectsDir)) ? [deps.projectsDir] : []),
    ...(await legacyWorktreeDirs(deps.worktreesDir)),
  ];
  try {
    for (const dir of dirs) await (runner as Reclaims).reclaim(await realpath(dir));
  } catch (err) {
    log.error(
      { err: err instanceof Error ? err.message : String(err) },
      "could not take the shared floor clones back from runner accounts; install the current " +
        "office-runner-helper and sudoers rules (docs/deploy/linux-user-runner.md). Retrying next boot",
    );
    return;
  }
  if (await exists(deps.projectsDir)) await writeFile(marker, LAYOUT);
  log.info({ dirs: dirs.length }, "shared floor clones reclaimed from runner accounts");
}
