/**
 * "Is this human signed in to the CLI?", answered by the unmodified CLI
 * itself inside their runner (SPEC §8 rule 1). The office never opens a
 * credential file:
 *
 * - Claude Code: `claude auth status` exits 0 when logged in, 1 when not
 *   (https://code.claude.com/docs/en/cli-reference). Only the exit code is
 *   used; stdout (JSON with account details) is drained unread.
 * - Codex: a short-lived `codex app-server` answers `account/read`; only
 *   whether `account` is null is used (the email and plan are dropped).
 */
import {
  baseEnv,
  CodexRpcClient,
  codexEnv,
  type RunnerContext,
  type SpawnPlan,
  tmuxSessionName,
} from "@regulus/agent-adapters";
import type { CliLoginProvider } from "@regulus/protocol";
import { bindRunnerOps, type Runner } from "../runners/types.ts";

export interface CliCommands {
  /** `claude` (tests point it at a fake script). */
  claude: string;
  /** `codex` argv prefix; `app-server` is appended. */
  codex: readonly string[];
}

export const DEFAULT_CLI_COMMANDS: CliCommands = { claude: "claude", codex: ["codex"] };

export const STATUS_TIMEOUT_MS = 15_000;

/** A `RunnerContext` for side processes (status, login) in `userId`'s runner. */
export async function runnerContext(
  runner: Runner,
  userId: string,
  officeUrl: string,
  now: () => number,
): Promise<RunnerContext> {
  const handle = await runner.provision({ userId });
  return {
    backend: runner.backend,
    userId,
    home: handle.home,
    runner: bindRunnerOps(runner, { userId }),
    officeUrl,
    now,
  };
}

/** Side-process id: not an agent, but shaped like one so every runner accepts it. */
export function sideProcessId(purpose: string, userId: string): string {
  return `${purpose}-${userId}`.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64);
}

export function sidePlan(
  ctx: RunnerContext,
  purpose: string,
  argv: string[],
  env: SpawnPlan["env"],
): SpawnPlan {
  const agentId = sideProcessId(purpose, ctx.userId);
  return {
    agentId,
    provider: purpose.startsWith("claude") ? "claude-code" : "codex",
    argv,
    env,
    cwd: ctx.home,
    tmuxSession: tmuxSessionName(agentId),
    files: [],
  };
}

export async function drain(stream: ReadableStream<Uint8Array>): Promise<void> {
  try {
    for await (const _chunk of stream) {
      // discarded unread: may describe the account
    }
  } catch {
    // process gone
  }
}

async function claudeLoggedIn(
  ctx: RunnerContext,
  command: string,
  timeoutMs: number,
): Promise<boolean | null> {
  const proc = await ctx.runner.spawnPiped(
    sidePlan(ctx, "claude-status", [command, "auth", "status"], baseEnv(ctx)),
  );
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
    return null;
  }
  if (code === 0) return true;
  if (code === 1) return false;
  return null;
}

async function codexLoggedIn(
  ctx: RunnerContext,
  command: readonly string[],
  timeoutMs: number,
): Promise<boolean | null> {
  const proc = await ctx.runner.spawnPiped(
    sidePlan(ctx, "codex-status", [...command, "app-server"], codexEnv(ctx)),
  );
  const client = new CodexRpcClient(proc, { requestTimeoutMs: timeoutMs });
  try {
    await client.initialize();
    const res = await client.request("account/read", { refreshToken: false });
    return res.account !== null;
  } catch {
    return null;
  } finally {
    await client.close();
  }
}

/** true / false from the CLI; null when it could not be asked (not installed, timeout). */
export async function cliLoggedIn(
  provider: CliLoginProvider,
  ctx: RunnerContext,
  commands: CliCommands = DEFAULT_CLI_COMMANDS,
  timeoutMs = STATUS_TIMEOUT_MS,
): Promise<boolean | null> {
  try {
    return provider === "claude-code"
      ? await claudeLoggedIn(ctx, commands.claude, timeoutMs)
      : await codexLoggedIn(ctx, commands.codex, timeoutMs);
  } catch {
    return null;
  }
}
