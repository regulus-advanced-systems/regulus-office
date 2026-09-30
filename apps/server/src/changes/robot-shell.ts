/**
 * Commands for the changes window (#38), run as the robot's owner inside
 * their runner, in the robot's own sandbox when it has one (SPEC §8, D17,
 * D18): `Runner.spawnPiped` with a plan for the robot, never a process of
 * the office on the owner's files.
 *
 * Every command is an argv (never a shell string). Output is capped: past
 * `maxBytes` the process is killed and the result says `truncated`. A timeout
 * kills it too.
 *
 * Git is told to stay out of the robot's way: `GIT_OPTIONAL_LOCKS=0` keeps
 * `status` and `diff` from rewriting the index the robot is using, repo
 * hooks and fsmonitor never run, external diff drivers and textconv are off
 * (`--no-ext-diff --no-textconv` at the call sites), and pathspecs are
 * literal (`GIT_LITERAL_PATHSPECS=1`), so a file called `*` means that file.
 */
import { SecretEnv, type SpawnPlan, tmuxSessionName } from "@regulus/agent-adapters";
import type { ProviderId } from "@regulus/protocol";
import type { Runner } from "../runners/types.ts";
import { agentGitEnv } from "../worktrees/git-ops.ts";

export interface RobotTarget {
  userId: string;
  agentId: string;
  provider: ProviderId;
  /** The robot's worktree: cwd of every command. */
  workdir: string;
  /** Its owner's clone (for `safe.directory`). */
  clone: string;
}

export interface CmdResult {
  /** Exit code; null when killed (timeout, cap, signal). */
  code: number | null;
  stdout: Uint8Array;
  stderr: string;
  truncated: boolean;
  timedOut: boolean;
}

export interface CmdOptions {
  /** Stdout cap in bytes (default 4 MiB). */
  maxBytes?: number;
  timeoutMs?: number;
}

const DEFAULT_MAX = 4 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 20_000;
const STDERR_MAX = 16 * 1024;

/** Config every git call carries. */
export const GIT_SAFE_CONFIG: readonly string[] = [
  "-c",
  "core.hooksPath=/dev/null",
  "-c",
  "core.fsmonitor=false",
  "-c",
  "core.quotePath=false",
  "-c",
  "color.ui=never",
];

export function gitEnv(target: Pick<RobotTarget, "workdir" | "clone">): Record<string, string> {
  return {
    ...agentGitEnv(target.workdir, target.clone),
    GIT_OPTIONAL_LOCKS: "0",
    GIT_LITERAL_PATHSPECS: "1",
    GIT_TERMINAL_PROMPT: "0",
    GIT_PAGER: "cat",
    PAGER: "cat",
    GIT_EDITOR: "true",
    LC_ALL: "C",
    LANG: "C",
  };
}

async function readCapped(
  stream: ReadableStream<Uint8Array>,
  max: number,
  onOverflow: () => void,
): Promise<{ bytes: Uint8Array; truncated: boolean }> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let truncated = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (size + value.byteLength > max) {
        chunks.push(value.subarray(0, max - size));
        size = max;
        truncated = true;
        onOverflow();
        break;
      }
      chunks.push(value);
      size += value.byteLength;
    }
  } finally {
    if (truncated) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let off = 0;
  for (const c of chunks) {
    bytes.set(c, off);
    off += c.byteLength;
  }
  return { bytes, truncated };
}

export class RobotShell {
  constructor(
    private readonly runner: Pick<Runner, "spawnPiped">,
    readonly target: RobotTarget,
  ) {}

  /** `git <safe config> <args>` in the worktree. */
  git(args: readonly string[], opts?: CmdOptions): Promise<CmdResult> {
    return this.run(["git", ...GIT_SAFE_CONFIG, ...args], opts);
  }

  /** Any argv in the worktree, with the same env (used for `stat`, `realpath`, `head`). */
  async run(argv: readonly string[], opts: CmdOptions = {}): Promise<CmdResult> {
    const { target } = this;
    const plan: SpawnPlan = {
      agentId: target.agentId,
      provider: target.provider,
      argv,
      env: SecretEnv.of(gitEnv(target)),
      cwd: target.workdir,
      tmuxSession: tmuxSessionName(target.agentId),
      files: [],
    };
    const proc = await this.runner.spawnPiped({ userId: target.userId }, plan);
    let killed = false;
    const kill = () => {
      if (killed) return;
      killed = true;
      try {
        proc.kill("SIGKILL");
      } catch {}
    };
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    try {
      const [out, err, code] = await Promise.all([
        readCapped(proc.stdout, opts.maxBytes ?? DEFAULT_MAX, kill),
        readCapped(proc.stderr, STDERR_MAX, () => undefined),
        proc.exited,
      ]);
      return {
        code: killed ? null : code,
        stdout: out.bytes,
        stderr: new TextDecoder().decode(err.bytes),
        truncated: out.truncated,
        timedOut,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

const decoder = new TextDecoder("utf-8", { fatal: false });
export const text = (bytes: Uint8Array): string => decoder.decode(bytes);
