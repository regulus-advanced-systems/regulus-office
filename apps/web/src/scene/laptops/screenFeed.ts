/**
 * Client of the laptop screen feed `/ws/screens/<operationId>` (server
 * `terminals/screens.ts`): plain-text screens of every henchman in the operation,
 * pushed on change at ≤ 2 Hz. Reconnects with backoff; after a reconnect the
 * server sends every current screen again.
 */
import { parseScreenFeedMessage, screensWsPath } from "@regulus/protocol";
import { type BackoffOptions, backoffDelay } from "../../net/backoff.ts";
import type { SocketFactory, SocketLike } from "../../ui/terminal/connection.ts";

export const SCREEN_FEED_BACKOFF: BackoffOptions = {
  baseMs: 1000,
  maxMs: 30_000,
  factor: 2,
  jitter: 0.3,
};

export interface ScreenFeedClientOptions {
  /** Base ws(s) URL of the office server. */
  wsBase: string;
  operationId: string;
  onScreen: (agentId: string, text: string) => void;
  onRemoved: (agentId: string) => void;
  socket?: SocketFactory;
  random?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export class ScreenFeedClient {
  readonly #opts: ScreenFeedClientOptions;
  #ws: SocketLike | null = null;
  #timer: unknown = null;
  #attempt = 0;
  #stopped = false;

  constructor(options: ScreenFeedClientOptions) {
    this.#opts = options;
  }

  start(): void {
    if (this.#stopped) return;
    const url = `${this.#opts.wsBase}${screensWsPath(this.#opts.operationId)}`;
    const ws = (this.#opts.socket ?? ((u: string) => new WebSocket(u) as unknown as SocketLike))(
      url,
    );
    this.#ws = ws;
    ws.onopen = () => {
      this.#attempt = 0;
    };
    ws.onmessage = (event) => {
      if (typeof event.data !== "string") return;
      const message = parseScreenFeedMessage(event.data);
      if (message?.type === "screen") this.#opts.onScreen(message.agentId, message.text);
      else if (message?.type === "removed") this.#opts.onRemoved(message.agentId);
    };
    ws.onerror = () => {};
    ws.onclose = () => {
      if (this.#ws !== ws || this.#stopped) return;
      this.#ws = null;
      const delay = backoffDelay(this.#attempt, SCREEN_FEED_BACKOFF, this.#opts.random);
      this.#attempt += 1;
      const setTimer = this.#opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
      this.#timer = setTimer(() => {
        this.#timer = null;
        this.start();
      }, delay);
    };
  }

  stop(): void {
    this.#stopped = true;
    if (this.#timer !== null) (this.#opts.clearTimer ?? clearTimeout)(this.#timer as never);
    this.#timer = null;
    const ws = this.#ws;
    this.#ws = null;
    if (ws) {
      ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
      ws.close(1000, "done");
    }
  }
}
