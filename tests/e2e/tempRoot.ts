/**
 * Where an e2e run keeps its throwaway office (database, clones, worktrees, logs), #299.
 *
 * The system temp directory, unless that is small: on a machine whose `/tmp` is a tmpfs of a
 * few gigabytes, a handful of runs' data and traces filled it and other runs' browsers then
 * failed to start. There the runs use `.e2e-local/tmp` in the repository instead.
 * `E2E_TMP_DIR` names another place.
 *
 * `.e2e-local/` is ignored by git and Playwright never empties it (it empties `test-results/`
 * at the start of every run): it is also where to keep a run's output, with
 * `--output=.e2e-local/<name>`, and notes that must outlive a run.
 */
import { mkdirSync, statfsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/** `.e2e-local` at the root of the repository. */
export const LOCAL_DIR = resolve(import.meta.dirname, "..", "..", ".e2e-local");
/** A temp file system smaller than this is not used for a run's data, bytes. */
export const SMALL_TEMP_BYTES = 8 * 1024 ** 3;

export interface TempRootInput {
  /** `E2E_TMP_DIR`, when set. */
  asked: string | undefined;
  /** The system temp directory, and the size of the file system it is on (null: unknown). */
  system: string;
  systemBytes: number | null;
  /** The fallback inside the repository. */
  local: string;
}

/** The directory to create a run's data under. Pure. */
export function pickTempRoot(input: TempRootInput): string {
  if (input.asked) return resolve(input.asked);
  if (input.systemBytes !== null && input.systemBytes < SMALL_TEMP_BYTES) return input.local;
  return input.system;
}

function sizeOf(dir: string): number | null {
  try {
    const fs = statfsSync(dir);
    return fs.blocks * fs.bsize;
  } catch {
    return null;
  }
}

/** The directory to create this run's data under; it exists when this returns. */
export function e2eTempRoot(): string {
  const system = tmpdir();
  const root = pickTempRoot({
    asked: process.env.E2E_TMP_DIR || undefined,
    system,
    systemBytes: sizeOf(system),
    local: join(LOCAL_DIR, "tmp"),
  });
  if (root !== system) mkdirSync(root, { recursive: true });
  return root;
}
