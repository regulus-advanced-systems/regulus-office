/**
 * "Is the CLI there at all?" (#151): `command -v <cli>` in the human's
 * runner. A sign-in that cannot start is only blamed on a missing CLI when
 * this says so; a broken runner or Docker reports its own cause instead.
 */
import { posix } from "node:path";
import { baseEnv, type RunnerContext } from "@regulus/agent-adapters";
import { drain, sidePlan } from "./cli-status.ts";

/** The CLI binary is not on the runner's PATH (`cli_missing`). */
export class CliMissingError extends Error {
  override name = "CliMissingError";
  constructor(readonly cli: string) {
    super(`${posix.basename(cli)} is not installed in the runner`);
  }
}

export const PROBE_TIMEOUT_MS = 10_000;

/**
 * false only when the shell in the runner says `bin` is not found; true when
 * found or when the answer is unclear (a timeout is not a missing CLI).
 * Runner and Docker failures are thrown as they are.
 */
export async function cliInstalled(
  ctx: RunnerContext,
  bin: string,
  timeoutMs = PROBE_TIMEOUT_MS,
): Promise<boolean> {
  const argv = ["sh", "-c", 'command -v "$1" >/dev/null 2>&1', "sh", bin];
  const purpose = `${posix.basename(bin).startsWith("claude") ? "claude" : "codex"}-probe`;
  const proc = await ctx.runner.spawnPiped(sidePlan(ctx, purpose, argv, baseEnv(ctx)));
  void drain(proc.stdout);
  void drain(proc.stderr);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), timeoutMs);
  });
  const code = await Promise.race([proc.exited, timedOut]);
  clearTimeout(timer);
  if (code === "timeout") {
    proc.kill("SIGKILL");
    return true;
  }
  // `command -v` exits 1 (dash, bash) or 127 when the name is not found.
  return code !== 1 && code !== 127;
}

/** Throw {@link CliMissingError} when `bin` is not found in the runner. */
export async function requireCli(ctx: RunnerContext, bin: string): Promise<void> {
  if (!(await cliInstalled(ctx, bin))) throw new CliMissingError(bin);
}
