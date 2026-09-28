/**
 * One terminal WebSocket connection after the upgrade: hello, scrollback,
 * then a private tmux client (PTY or backend stream) piped both ways.
 *
 * Watch mode is read-only twice over: the runner attaches with `attach -r`
 * (or the backend equivalent), and this class never forwards a watcher's
 * bytes or resizes to it at all.
 */
import {
  parseTerminalClientMessage,
  TERMINAL_CLOSE_CODES,
  TERMINAL_MAX_INPUT_BYTES,
  type TerminalMode,
  type TerminalServerMessage,
} from "@regulus/protocol";
import type { ServerWebSocket } from "bun";
import type { Logger } from "../logging.ts";
import type { TtySize } from "../runners/types.ts";
import { openPipe, type TerminalPipe } from "./pipe.ts";
import type { TerminalTarget } from "./targets.ts";

export interface ViewerOptions {
  target: TerminalTarget;
  mode: TerminalMode;
  userId: string;
  size: TtySize;
  scrollbackLines: number;
  /** Close a viewer whose unsent output exceeds this many bytes. */
  maxBufferedBytes: number;
  logger: Logger;
}

/** Input queued while the attach is still starting (control mode only). */
const MAX_PENDING_BYTES = TERMINAL_MAX_INPUT_BYTES;

/** tmux prints bare `\n` in capture-pane output; a terminal needs `\r\n`. */
export function scrollbackBytes(text: string): Uint8Array {
  const trimmed = text.replace(/\n+$/, "");
  if (trimmed.length === 0) return new Uint8Array();
  return new TextEncoder().encode(`${trimmed.replace(/\r?\n/g, "\r\n")}\r\n`);
}

export class TerminalViewer {
  readonly #ws: ServerWebSocket<unknown>;
  readonly #opts: ViewerOptions;
  #pipe: TerminalPipe | undefined;
  #pending: Uint8Array[] = [];
  #pendingBytes = 0;
  #size: TtySize;
  #closed = false;
  #droppedInput = false;

  constructor(ws: ServerWebSocket<unknown>, options: ViewerOptions) {
    this.#ws = ws;
    this.#opts = options;
    this.#size = options.size;
  }

  get mode(): TerminalMode {
    return this.#opts.mode;
  }

  sendControl(message: TerminalServerMessage): void {
    if (!this.#closed) this.#ws.sendText(JSON.stringify(message));
  }

  /** Scrollback, then the live attach. Call once, right after `hello`. */
  async start(): Promise<void> {
    const { target, mode, logger } = this.#opts;
    try {
      const text = await target.runner.capturePane(target.session, this.#opts.scrollbackLines);
      const bytes = scrollbackBytes(text);
      if (bytes.byteLength > 0) this.#send(bytes);
    } catch (err) {
      logger.debug({ err, agentId: target.agentId }, "terminal scrollback unavailable");
    }
    if (this.#closed) return;
    let pipe: TerminalPipe;
    try {
      pipe = await openPipe(target.runner.attach(target.session, mode), this.#size, (bytes) =>
        this.#send(bytes),
      );
    } catch (err) {
      logger.warn({ err, agentId: target.agentId, mode }, "terminal attach failed");
      this.#closeSocket(TERMINAL_CLOSE_CODES.attachFailed, "attach failed");
      return;
    }
    if (this.#closed) {
      pipe.close();
      return;
    }
    this.#pipe = pipe;
    for (const chunk of this.#pending) pipe.write(chunk);
    this.#pending = [];
    this.#pendingBytes = 0;
    void pipe.closed.then(() => this.#closeSocket(TERMINAL_CLOSE_CODES.sessionEnded, "ended"));
  }

  onMessage(message: string | Buffer): void {
    if (this.#closed) return;
    if (typeof message === "string") {
      this.#onControl(message);
      return;
    }
    if (this.#opts.mode !== "control") {
      // Read-only: drop keystrokes server-side as well (SPEC §8 rule 4).
      if (!this.#droppedInput) {
        this.#droppedInput = true;
        this.#opts.logger.debug(
          { agentId: this.#opts.target.agentId, userId: this.#opts.userId },
          "dropping input from a watch-only terminal",
        );
      }
      return;
    }
    if (message.byteLength > TERMINAL_MAX_INPUT_BYTES) {
      this.#closeSocket(1009, "input too large");
      return;
    }
    const bytes = new Uint8Array(message);
    if (this.#pipe) {
      this.#pipe.write(bytes);
    } else if (this.#pendingBytes + bytes.byteLength <= MAX_PENDING_BYTES) {
      this.#pending.push(bytes);
      this.#pendingBytes += bytes.byteLength;
    }
  }

  /** The socket closed: detach this viewer's tmux client. */
  dispose(): void {
    this.#closed = true;
    this.#pending = [];
    this.#pipe?.close();
  }

  #onControl(text: string): void {
    const message = parseTerminalClientMessage(text);
    if (!message) return;
    // Watchers keep the fixed size: a read-only client must not reshape the agent's window.
    if (message.type === "resize" && this.#opts.mode === "control") {
      this.#size = { cols: message.cols, rows: message.rows };
      this.#pipe?.resize(this.#size);
    }
  }

  #send(bytes: Uint8Array): void {
    if (this.#closed) return;
    const status = this.#ws.sendBinary(bytes);
    // 0 = dropped by Bun; either way a gap would corrupt the screen, so resync by reconnecting.
    if (status === 0 || this.#ws.getBufferedAmount() > this.#opts.maxBufferedBytes) {
      this.#closeSocket(TERMINAL_CLOSE_CODES.slowConsumer, "slow consumer");
    }
  }

  #closeSocket(code: number, reason: string): void {
    if (this.#closed) return;
    this.dispose();
    this.#ws.close(code, reason);
  }
}
