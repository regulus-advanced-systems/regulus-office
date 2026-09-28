/**
 * Invokes the privileged helper (`sudo -n office-runner-helper <verb> ...`).
 * The process-spawning functions are injectable so unit tests can mock the
 * helper and assert on the exact argv and stdin.
 *
 * Stdin may carry secrets (env scripts, file contents); it is never included
 * in errors or logs. Helper stderr is included: the helper never echoes stdin.
 */
import type { PipedProcess } from "@regulus/agent-adapters";

export const DEFAULT_HELPER_PATH = "/usr/local/lib/office/office-runner-helper";

export interface HelperResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface HelperCall {
  argv: readonly string[];
  stdin?: string;
  timeoutMs: number;
}

/** Run a command to completion. */
export type RunCommand = (call: HelperCall) => Promise<HelperResult>;
/** Start a long-lived command with piped stdio. */
export type SpawnCommand = (argv: readonly string[]) => PipedProcess;

export class HelperError extends Error {
  constructor(
    readonly verb: string,
    readonly code: number,
    stderr: string,
  ) {
    super(`office-runner-helper ${verb} failed (${code}): ${stderr.trim().slice(0, 500)}`);
    this.name = "HelperError";
  }
}

export const runCommand: RunCommand = async ({ argv, stdin, timeoutMs }) => {
  const proc = Bun.spawn([...argv], {
    stdin: stdin === undefined ? "ignore" : new TextEncoder().encode(stdin),
    stdout: "pipe",
    stderr: "pipe",
    env: cleanEnv(),
    timeout: timeoutMs,
    killSignal: "SIGKILL",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code: proc.signalCode ? 128 : code, stdout, stderr };
};

export const spawnCommand: SpawnCommand = (argv) => {
  const proc = Bun.spawn([...argv], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: cleanEnv(),
  });
  return {
    pid: proc.pid,
    stdout: proc.stdout,
    stderr: proc.stderr,
    exited: proc.exited.then((code) => (proc.signalCode ? null : code)),
    async write(chunk) {
      proc.stdin.write(chunk);
      await proc.stdin.flush();
    },
    kill: (signal) => proc.kill(signal),
  };
};

/** sudo resets the environment anyway; don't hand it the server's (TMUX, secrets). */
function cleanEnv(): Record<string, string> {
  return { PATH: process.env.PATH ?? "/usr/bin:/bin", LANG: "C.UTF-8" };
}

export interface HelperOptions {
  helperPath?: string;
  sudoPath?: string;
  timeoutMs?: number;
  run?: RunCommand;
  spawn?: SpawnCommand;
}

export class Helper {
  readonly helperPath: string;
  readonly sudoPath: string;
  readonly #timeoutMs: number;
  readonly #run: RunCommand;
  readonly #spawn: SpawnCommand;

  constructor(opts: HelperOptions = {}) {
    this.helperPath = opts.helperPath ?? DEFAULT_HELPER_PATH;
    this.sudoPath = opts.sudoPath ?? "sudo";
    this.#timeoutMs = opts.timeoutMs ?? 60_000;
    this.#run = opts.run ?? runCommand;
    this.#spawn = opts.spawn ?? spawnCommand;
  }

  argv(verb: string, args: readonly string[]): string[] {
    return [this.sudoPath, "-n", this.helperPath, verb, ...args];
  }

  /** Run a verb; any exit code outside `ok` throws a `HelperError`. */
  async call(
    verb: string,
    args: readonly string[],
    opts: { stdin?: string; ok?: readonly number[] } = {},
  ): Promise<HelperResult> {
    const res = await this.#run({
      argv: this.argv(verb, args),
      stdin: opts.stdin,
      timeoutMs: this.#timeoutMs,
    });
    if (!(opts.ok ?? [0]).includes(res.code)) throw new HelperError(verb, res.code, res.stderr);
    return res;
  }

  spawn(verb: string, args: readonly string[]): PipedProcess {
    return this.#spawn(this.argv(verb, args));
  }
}
