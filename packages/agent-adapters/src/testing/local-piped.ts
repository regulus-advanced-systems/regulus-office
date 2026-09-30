/**
 * Test-only `RunnerOps.spawnPiped` that runs the plan on this machine: writes
 * `plan.files`, then starts `plan.argv` with only `plan.env` (a temp HOME in
 * tests, never the real one).
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { PipedProcess, SpawnPlan } from "../types.ts";

export async function localSpawnPiped(plan: SpawnPlan): Promise<PipedProcess> {
  for (const file of plan.files) {
    await mkdir(dirname(file.path), { recursive: true });
    const contents = typeof file.contents === "string" ? file.contents : file.contents.reveal();
    await writeFile(file.path, contents, { mode: file.mode ?? 0o600 });
  }
  const proc = Bun.spawn([...plan.argv], {
    cwd: plan.cwd,
    env: { PATH: process.env.PATH ?? "/usr/bin:/bin", ...plan.env.reveal() },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    pid: proc.pid,
    async write(chunk) {
      proc.stdin.write(chunk);
      await proc.stdin.flush();
    },
    stdout: proc.stdout,
    stderr: proc.stderr,
    exited: proc.exited.then((code) => (proc.signalCode ? null : code)),
    kill: (signal) => proc.kill(signal),
  };
}
