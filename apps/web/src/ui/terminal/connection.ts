/**
 * Client for the terminal socket (SPEC §6 channel 3, server #24):
 * `/ws/term/<agentId>?mode=watch|control`. Binary frames are PTY bytes,
 * text frames are `hello` / `viewers` / `typing`.
 *
 * Reconnects with exponential backoff. Browsers cannot see the HTTP status
 * of a refused upgrade (401/403/404/502 all look like close 1006 before
 * `open`), so a control attach that never opens is treated as refused and
 * retried as watch; the server's ACL is the authority. Close codes:
 * 4000 session ended (stop), 4008 slow consumer (reconnect at once, the
 * scrollback resyncs the screen), 4011 attach failed (retry with backoff).
 * Access closes (#244, protocol `ACCESS_CLOSE_CODES`): signed out or access
 * withdrawn stop for good with a plain notice; control taken away comes back
 * in watch mode.
 */
import {
  accessCloseKind,
  parseTerminalServerMessage,
  TERMINAL_CLOSE_CODES,
  TERMINAL_MAX_INPUT_BYTES,
  type TerminalMode,
} from "@regulus/protocol";
import { type BackoffOptions, backoffDelay } from "../../net/backoff.ts";
import type { TerminalEvent } from "./terminalState.ts";

/** The part of the WebSocket API the connection uses (injectable for tests). */
export interface SocketLike {
  binaryType: string;
  readonly readyState: number;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { code: number }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  send(data: string | ArrayBufferView | ArrayBuffer): void;
  close(code?: number, reason?: string): void;
}

export type SocketFactory = (url: string) => SocketLike;

export const TERMINAL_BACKOFF: BackoffOptions = {
  baseMs: 1000,
  maxMs: 15_000,
  factor: 2,
  jitter: 0.2,
};

/** Consecutive failed attempts before giving up. */
export const TERMINAL_MAX_ATTEMPTS = 6;

/** A connection that stayed up this long resets the failure count. */
export const TERMINAL_STABLE_MS = 10_000;

export type CloseAction =
  | "ended"
  | "signed_out"
  | "revoked"
  | "downgrade"
  | "retry_now"
  | "retry"
  | "give_up";

/** What to do after a close; pure so the policy is testable on its own. */
export function closeAction(
  code: number,
  opened: boolean,
  mode: TerminalMode,
  failures: number,
  maxAttempts = TERMINAL_MAX_ATTEMPTS,
): CloseAction {
  if (code === TERMINAL_CLOSE_CODES.sessionEnded) return "ended";
  const access = accessCloseKind(code);
  if (access === "signedOut") return "signed_out";
  if (access === "revoked") return "revoked";
  // Still allowed, differently: a controller may only watch now.
  if (access === "changed") return mode === "control" ? "downgrade" : "retry_now";
  if (!opened && mode === "control") return "downgrade";
  if (code === TERMINAL_CLOSE_CODES.slowConsumer && opened) return "retry_now";
  if (failures >= maxAttempts) return "give_up";
  return "retry";
}

export interface TerminalConnectionOptions {
  /** Absolute ws(s) URL for a mode. */
  url: (mode: TerminalMode) => string;
  mode: TerminalMode;
  onBytes: (bytes: Uint8Array) => void;
  onEvent: (event: TerminalEvent) => void;
  socket?: SocketFactory;
  backoff?: BackoffOptions;
  random?: () => number;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

const OPEN = 1;

export class TerminalConnection {
  readonly #opts: TerminalConnectionOptions;
  readonly #encoder = new TextEncoder();
  #mode: TerminalMode;
  #granted: TerminalMode | null = null;
  #ws: SocketLike | null = null;
  #timer: unknown = null;
  #failures = 0;
  #attempts = 0;
  #disposed = false;
  /** The size in `hello`, and the one this controller last asked for. */
  #helloSize: { cols: number; rows: number } | null = null;
  #sentSize: { cols: number; rows: number } | null = null;

  constructor(options: TerminalConnectionOptions) {
    this.#opts = options;
    this.#mode = options.mode;
  }

  /** Mode currently requested (may have fallen back from control to watch). */
  get mode(): TerminalMode {
    return this.#mode;
  }

  /** Mode the server granted on the live connection, if any. */
  get granted(): TerminalMode | null {
    return this.#granted;
  }

  connect(): void {
    if (this.#disposed) return;
    this.#opts.onEvent({ kind: "connecting", attempt: this.#attempts });
    this.#attempts += 1;
    const factory =
      this.#opts.socket ?? ((url: string) => new WebSocket(url) as unknown as SocketLike);
    const ws = factory(this.#opts.url(this.#mode));
    this.#ws = ws;
    ws.binaryType = "arraybuffer";
    let opened = false;
    let openedAt = 0;
    ws.onopen = () => {
      opened = true;
      openedAt = this.#now();
    };
    ws.onmessage = (event) => this.#onMessage(event.data);
    ws.onerror = () => {};
    ws.onclose = (event) => {
      if (this.#ws !== ws) return;
      this.#ws = null;
      this.#granted = null;
      if (this.#disposed) return;
      // Failures count until a connection proves stable (an attach that fails right after
      // `hello` must not reconnect forever at the base delay).
      if (opened && this.#now() - openedAt >= TERMINAL_STABLE_MS) this.#failures = 0;
      else this.#failures += 1;
      this.#onClose(event.code, opened);
    };
  }

  /** Keystrokes from xterm; dropped unless the server granted control. */
  send(data: string): void {
    if (this.#granted !== "control" || this.#ws?.readyState !== OPEN) return;
    const bytes = this.#encoder.encode(data);
    // A long paste goes in frames the server accepts (it splits nothing itself).
    for (let at = 0; at < bytes.byteLength; at += TERMINAL_MAX_INPUT_BYTES) {
      this.#ws.send(bytes.subarray(at, at + TERMINAL_MAX_INPUT_BYTES));
    }
  }

  /**
   * Asks tmux to reflow to `cols`×`rows` (#156). Only a controller may: a
   * watcher's resize would reshape the agent's window for everyone, and the
   * server ignores it anyway (#105). Returns whether it was sent.
   */
  resize(cols: number, rows: number): boolean {
    if (this.#granted !== "control" || this.#ws?.readyState !== OPEN) return false;
    if (this.#sentSize?.cols === cols && this.#sentSize.rows === rows) return false;
    this.#ws.send(JSON.stringify({ type: "resize", cols, rows }));
    this.#sentSize = { cols, rows };
    return true;
  }

  dispose(): void {
    this.#disposed = true;
    if (this.#timer !== null) (this.#opts.clearTimer ?? clearTimeout)(this.#timer as never);
    this.#timer = null;
    const ws = this.#ws;
    this.#ws = null;
    if (ws) {
      // A controller leaving puts the shared window back to the size watchers expect.
      const hello = this.#helloSize;
      const sent = this.#sentSize;
      if (this.#granted === "control" && ws.readyState === OPEN && hello && sent) {
        if (sent.cols !== hello.cols || sent.rows !== hello.rows)
          ws.send(JSON.stringify({ type: "resize", cols: hello.cols, rows: hello.rows }));
      }
      ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
      ws.close(1000, "closed");
    }
  }

  #onMessage(data: unknown): void {
    if (typeof data !== "string") {
      if (data instanceof ArrayBuffer) this.#opts.onBytes(new Uint8Array(data));
      else if (ArrayBuffer.isView(data))
        this.#opts.onBytes(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
      return;
    }
    const message = parseTerminalServerMessage(data);
    if (!message) return;
    const { onEvent } = this.#opts;
    if (message.type === "hello") {
      this.#granted = message.mode;
      this.#helloSize = { cols: message.cols, rows: message.rows };
      // A new attach starts at the hello size again.
      this.#sentSize =
        message.mode === "control" ? { cols: message.cols, rows: message.rows } : null;
      onEvent({
        kind: "hello",
        mode: message.mode,
        cols: message.cols,
        rows: message.rows,
        viewers: message.viewers,
        peers: message.peers,
      });
    } else if (message.type === "viewers") {
      onEvent({ kind: "viewers", viewers: message.viewers, peers: message.peers });
    } else {
      onEvent({
        kind: "typing",
        userId: message.userId,
        name: message.name,
        at: this.#now(),
      });
    }
  }

  #now(): number {
    return (this.#opts.now ?? Date.now)();
  }

  #onClose(code: number, opened: boolean): void {
    const action = closeAction(code, opened, this.#mode, this.#failures);
    const { onEvent } = this.#opts;
    switch (action) {
      case "ended":
        onEvent({ kind: "ended" });
        return;
      case "signed_out":
      case "revoked":
        onEvent({ kind: "access_lost", signedOut: action === "signed_out" });
        return;
      case "give_up":
        onEvent({ kind: "unavailable" });
        return;
      case "downgrade":
        this.#mode = "watch";
        this.#failures = 0;
        onEvent({ kind: "downgraded" });
        this.connect();
        return;
      case "retry_now":
        this.#failures = 0;
        this.connect();
        return;
      case "retry": {
        const delayMs = backoffDelay(
          Math.max(0, this.#failures - 1),
          this.#opts.backoff ?? TERMINAL_BACKOFF,
          this.#opts.random,
        );
        onEvent({ kind: "retry", delayMs });
        const setTimer = this.#opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
        this.#timer = setTimer(() => {
          this.#timer = null;
          this.connect();
        }, delayMs);
      }
    }
  }
}
