/**
 * Interactive execs for the docker backend: piped side processes
 * (`spawnPiped`, e.g. `codex app-server`) and TTY attaches for the terminal
 * bridge (#24). Both ride a hijacked Engine API connection.
 */
import type { PipedProcess } from "@regulus/agent-adapters";
import type { DuplexTty, TtySize } from "../types.ts";
import type { EngineClient } from "./engine.ts";
import { demux } from "./mux.ts";

const PID_PREFIX = "office-pid:";

/**
 * Wraps argv so the process reports its in-container pid on stderr before it
 * `exec`s; Docker has no API to signal an exec, so `kill` needs that pid.
 */
export function pidReportingCmd(argv: readonly string[]): string[] {
  return ["sh", "-c", `printf '${PID_PREFIX}%s\\n' "$$" >&2; exec "$@"`, "sh", ...argv];
}

export interface PipedExecOptions {
  containerId: string;
  argv: readonly string[];
  /** `NAME=value`, secret-bearing: exec-scoped, never stored on the container. */
  env: readonly string[];
  workdir: string;
  /** Deliver a signal to an in-container pid (via another exec). */
  signal(pid: number, signal: NodeJS.Signals): Promise<void>;
}

export async function startPiped(
  engine: EngineClient,
  opts: PipedExecOptions,
): Promise<PipedProcess> {
  const { id, conn } = await engine.execInteractive(opts.containerId, {
    cmd: pidReportingCmd(opts.argv),
    env: opts.env,
    workdir: opts.workdir,
    tty: false,
  });
  const { stdout, stderr: rawStderr } = demux(conn.readable);
  const { pid, stderr } = await splitPid(rawStderr);
  let signalled = false;
  const exited = conn.closed.then(async () => {
    const code = await engine.execExitCode(id);
    return signalled && code > 128 ? null : code;
  });
  return {
    pid,
    stdout,
    stderr,
    exited,
    write: (chunk) => conn.write(chunk),
    kill(signal = "SIGTERM") {
      signalled = true;
      opts.signal(pid, signal).catch(() => {});
    },
  };
}

/** Read the `office-pid:<n>` line off the front of stderr and pass the rest through. */
async function splitPid(
  source: ReadableStream<Uint8Array>,
): Promise<{ pid: number; stderr: ReadableStream<Uint8Array> }> {
  const reader = source.getReader();
  let head: Uint8Array<ArrayBufferLike> = new Uint8Array(0);
  for (;;) {
    const nl = head.indexOf(10);
    if (nl >= 0) {
      const line = new TextDecoder().decode(head.subarray(0, nl));
      if (!line.startsWith(PID_PREFIX)) throw new Error("piped exec did not report its pid");
      const rest = head.slice(nl + 1);
      const stderr = new ReadableStream<Uint8Array>({
        start: (c) => {
          if (rest.length > 0) c.enqueue(rest);
        },
        pull: async (c) => {
          const { value, done } = await reader.read();
          if (done) c.close();
          else c.enqueue(value);
        },
        cancel: (reason) => reader.cancel(reason),
      });
      return { pid: Number(line.slice(PID_PREFIX.length)), stderr };
    }
    const { value, done } = await reader.read();
    if (done) throw new Error("piped exec ended before it started");
    const merged = new Uint8Array(head.length + value.length);
    merged.set(head);
    merged.set(value, head.length);
    head = merged;
  }
}

export interface AttachExecOptions {
  containerId: string;
  argv: readonly string[];
  size: TtySize;
}

/** `tmux attach` in an exec with a TTY; the hijacked connection is the terminal. */
export async function openTty(engine: EngineClient, opts: AttachExecOptions): Promise<DuplexTty> {
  const { id, conn } = await engine.execInteractive(opts.containerId, {
    cmd: opts.argv,
    env: ["TERM=xterm-256color", "COLORTERM=truecolor"],
    tty: true,
    consoleSize: [opts.size.rows, opts.size.cols],
  });
  return {
    output: conn.readable,
    write: (data) => conn.write(data),
    resize: (size) => engine.resizeExec(id, size.rows, size.cols),
    close: () => conn.close(),
    closed: conn.closed,
  };
}
