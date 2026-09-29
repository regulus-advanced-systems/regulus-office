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
  /** Set when the helper was stopped because it ran past its timeout. */
  timedOut?: boolean;
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

/** Exit code reported for a helper stopped at its timeout (as coreutils `timeout`). */
export const TIMEOUT_CODE = 124;
/** After SIGTERM (which sudo relays to the helper), how long before SIGKILL. */
const KILL_GRACE_MS = 2_000;

export class HelperError extends Error {
  constructor(
    readonly verb: string,
    readonly code: number,
    stderr: string,
    readonly timedOutAfterMs?: number,
  ) {
    super(
      timedOutAfterMs === undefined
        ? `office-runner-helper ${verb} failed (${code}): ${stderr.trim().slice(0, 500)}`
        : `office-runner-helper ${verb} timed out after ${timedOutAfterMs} ms: ${stderr.trim().slice(0, 500)}`,
    );
    this.name = "HelperError";
  }
}

export const runCommand: RunCommand = async ({ argv, stdin, timeoutMs }) => {
  const proc = Bun.spawn([...argv], {
    stdin: stdin === undefined ? "ignore" : new TextEncoder().encode(stdin),
    stdout: "pipe",
    stderr: "pipe",
    env: cleanEnv(),
  });
  const output = Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  output.catch(() => {});
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), timeoutMs);
  });
  const first = await Promise.race([output, expired]);
  clearTimeout(timer);
  if (first !== "timeout") {
    const [stdout, stderr, code] = first;
    return { code: proc.signalCode ? 128 : code, stdout, stderr };
  }
  // SIGTERM first: sudo relays it to the helper (a SIGKILL would stop sudo
  // alone). Don't wait for EOF: a child such as useradd can hold our pipes
  // until it finishes. Waiting for it made 60 s timeouts return after 79 and
  // 103 s, with no hint that they had timed out (#117).
  proc.kill("SIGTERM");
  const killer = setTimeout(() => proc.kill("SIGKILL"), KILL_GRACE_MS);
  await Promise.race([proc.exited, Bun.sleep(KILL_GRACE_MS + 500)]);
  clearTimeout(killer);
  return { code: TIMEOUT_CODE, stdout: "", stderr: "", timedOut: true };
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

/** One finished helper call, for timing logs (never carries stdin or stdout). */
export interface HelperCallEvent {
  verb: string;
  ms: number;
  code: number;
  timedOut: boolean;
}

/** Default helper timeout per call. */
export const DEFAULT_TIMEOUT_MS = 60_000;
/**
 * `provision` creates an account (useradd) and starts a tmux server under
 * systemd. The first useradd on a fresh host can take tens of seconds (it was
 * 22-53 s on GitHub runners, #117), so it gets a longer budget by default.
 */
export const DEFAULT_VERB_TIMEOUTS_MS: Readonly<Record<string, number>> = { provision: 180_000 };

export interface HelperOptions {
  helperPath?: string;
  sudoPath?: string;
  /** Timeout for every verb without an entry in `verbTimeoutsMs`. */
  timeoutMs?: number;
  /** Per-verb timeouts; merged over `DEFAULT_VERB_TIMEOUTS_MS`. */
  verbTimeoutsMs?: Readonly<Record<string, number>>;
  /** Called after every `call` (also failed and timed-out ones). */
  onCall?: (event: HelperCallEvent) => void;
  run?: RunCommand;
  spawn?: SpawnCommand;
}

export class Helper {
  readonly helperPath: string;
  readonly sudoPath: string;
  readonly #timeoutMs: number;
  readonly #verbTimeoutsMs: Readonly<Record<string, number>>;
  readonly #onCall: ((event: HelperCallEvent) => void) | undefined;
  readonly #run: RunCommand;
  readonly #spawn: SpawnCommand;

  constructor(opts: HelperOptions = {}) {
    this.helperPath = opts.helperPath ?? DEFAULT_HELPER_PATH;
    this.sudoPath = opts.sudoPath ?? "sudo";
    this.#timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#verbTimeoutsMs = { ...DEFAULT_VERB_TIMEOUTS_MS, ...opts.verbTimeoutsMs };
    this.#onCall = opts.onCall;
    this.#run = opts.run ?? runCommand;
    this.#spawn = opts.spawn ?? spawnCommand;
  }

  argv(verb: string, args: readonly string[]): string[] {
    return [this.sudoPath, "-n", this.helperPath, verb, ...args];
  }

  timeoutFor(verb: string): number {
    return this.#verbTimeoutsMs[verb] ?? this.#timeoutMs;
  }

  /** Run a verb; a timeout or any exit code outside `ok` throws a `HelperError`. */
  async call(
    verb: string,
    args: readonly string[],
    opts: { stdin?: string; ok?: readonly number[] } = {},
  ): Promise<HelperResult> {
    const timeoutMs = this.timeoutFor(verb);
    const started = performance.now();
    const res = await this.#run({ argv: this.argv(verb, args), stdin: opts.stdin, timeoutMs });
    const timedOut = res.timedOut === true;
    this.#onCall?.({ verb, ms: Math.round(performance.now() - started), code: res.code, timedOut });
    if (timedOut) throw new HelperError(verb, res.code, res.stderr, timeoutMs);
    if (!(opts.ok ?? [0]).includes(res.code)) throw new HelperError(verb, res.code, res.stderr);
    return res;
  }

  spawn(verb: string, args: readonly string[]): PipedProcess {
    return this.#spawn(this.argv(verb, args));
  }
}
