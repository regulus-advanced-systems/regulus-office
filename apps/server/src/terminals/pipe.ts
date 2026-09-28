/**
 * One viewer's live attachment to a tmux session, whatever the runner
 * returned from `attach()` (runners/types.ts):
 *
 * - `argv` (linux-user, the test runner): run the command in a local PTY via
 *   Bun's native terminal support (`Bun.spawn` with `terminal`, Bun ≥ 1.3.5).
 * - `stream` (docker): the backend already allocated a TTY; pipe it as is.
 *
 * Closing a pipe detaches that tmux client only; the session keeps running.
 */
import type { AttachArgv, AttachCommand, DuplexTty, TtySize } from "../runners/types.ts";

export interface TerminalPipe {
  /** Keystrokes into the attached client. Ignored after close. */
  write(data: Uint8Array): void;
  resize(size: TtySize): void;
  /** Detach (idempotent). */
  close(): void;
  /** Resolves once the attach has ended, for any reason. */
  readonly closed: Promise<void>;
}

export class PtyUnavailableError extends Error {
  override name = "PtyUnavailableError";
}

/** Bun's PTY support is POSIX-only and new in 1.3.5; the spec's fallback is `bun-pty`. */
export const hasBunPty = (): boolean =>
  typeof (Bun as { Terminal?: unknown }).Terminal === "function" && process.platform !== "win32";

/** Open `cmd` at `size`, delivering output bytes to `onData` until it closes. */
export async function openPipe(
  cmd: AttachCommand,
  size: TtySize,
  onData: (bytes: Uint8Array) => void,
): Promise<TerminalPipe> {
  if (cmd.kind === "stream") return pipeStream(await cmd.open(size), onData);
  return spawnPty(cmd, size, onData);
}

/**
 * Environment for the local tmux client: just enough for it to run and speak
 * UTF-8. The office process env (secrets, `TMUX`) is deliberately not passed.
 */
function clientEnv(cmd: AttachArgv): Record<string, string> {
  return {
    PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
    TERM: "xterm-256color",
    LANG: "C.UTF-8",
    ...cmd.env,
  };
}

function spawnPty(
  cmd: AttachArgv,
  size: TtySize,
  onData: (bytes: Uint8Array) => void,
): TerminalPipe {
  if (!hasBunPty()) throw new PtyUnavailableError("Bun PTY support is unavailable on this host");
  let open = true;
  const proc = Bun.spawn([...cmd.argv], {
    env: clientEnv(cmd),
    terminal: {
      cols: size.cols,
      rows: size.rows,
      name: "xterm-256color",
      data: (_term, bytes) => {
        if (open) onData(bytes);
      },
    },
  });
  const terminal = proc.terminal;
  if (!terminal) {
    proc.kill();
    throw new PtyUnavailableError("Bun.spawn did not allocate a terminal");
  }
  const closed = proc.exited.then(
    () => undefined,
    () => undefined,
  );
  void closed.then(() => {
    open = false;
    terminal.close();
  });
  return {
    write(data) {
      if (open && !terminal.closed) terminal.write(data);
    },
    resize({ cols, rows }) {
      if (open && !terminal.closed) terminal.resize(cols, rows);
    },
    close() {
      if (!open) return;
      open = false;
      // SIGTERM makes the tmux client detach; the session and its agent are untouched.
      proc.kill("SIGTERM");
    },
    closed,
  };
}

function pipeStream(tty: DuplexTty, onData: (bytes: Uint8Array) => void): TerminalPipe {
  let open = true;
  // Keystrokes must arrive in order even though each write is async.
  let writes: Promise<void> = Promise.resolve();
  const reader = tty.output.getReader();
  const pump = (async () => {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (open && value.byteLength > 0) onData(value);
      }
    } catch {
      // The connection dropped; `closed` settles below.
    }
  })();
  const closed = Promise.race([tty.closed.catch(() => undefined), pump]).then(() => {
    open = false;
  });
  return {
    write(data) {
      if (!open) return;
      writes = writes.then(() => tty.write(data)).catch(() => undefined);
    },
    resize(size) {
      if (open) void tty.resize(size).catch(() => undefined);
    },
    close() {
      if (!open) return;
      open = false;
      tty.close();
      void reader.cancel().catch(() => undefined);
    },
    closed,
  };
}
