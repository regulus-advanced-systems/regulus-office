/**
 * JSON-RPC 2.0 client for `codex app-server` over stdio.
 *
 * Wire format (https://learn.chatgpt.com/docs/app-server, "Protocol"): one JSON
 * object per line (JSONL), with the `"jsonrpc": "2.0"` member omitted. Both
 * sides send requests: the client calls methods such as `turn/start`; the
 * server asks the client for approvals (`item/commandExecution/requestApproval`)
 * and the client answers with a response carrying the same `id`.
 *
 * This module is transport plumbing only: request ids, per-request timeouts,
 * notification / server-request dispatch and clean shutdown. It never logs
 * message contents (they can carry prompts, diffs and command output).
 */
import type { PipedProcess } from "../types.ts";

export type RpcId = string | number;

export interface RpcErrorBody {
  code: number;
  message: string;
  data?: unknown;
}

/** A JSON-RPC error returned by the server (or a local timeout / close). */
export class RpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly method?: string,
  ) {
    super(method ? `${method}: ${message}` : message);
    this.name = "RpcError";
  }
}

/** Local error codes (outside the JSON-RPC reserved range). */
export const RPC_TIMEOUT = -32900;
export const RPC_CLOSED = -32901;
/** Sent back for server requests this client does not implement. */
export const RPC_METHOD_NOT_FOUND = -32601;

export interface IncomingRequest {
  id: RpcId;
  method: string;
  params: unknown;
}

export interface ProcessExit {
  code: number | null;
}

export interface JsonRpcConnectionOptions {
  /** Default timeout for `request`, ms. */
  requestTimeoutMs?: number;
  onNotification?: (method: string, params: unknown) => void;
  onRequest?: (request: IncomingRequest) => void;
  /** Called once when the process exits (after pending requests are rejected). */
  onExit?: (exit: ProcessExit) => void;
}

interface Pending {
  method: string;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const SHUTDOWN_GRACE_MS = 3_000;
const STDOUT_DRAIN_MS = 500;

export class JsonRpcConnection {
  readonly #proc: PipedProcess;
  readonly #opts: JsonRpcConnectionOptions;
  readonly #pending = new Map<RpcId, Pending>();
  readonly #exited: Promise<ProcessExit>;
  #nextId = 0;
  #closed = false;
  /** Lines that were not valid JSON-RPC messages; counted, never logged. */
  malformedLines = 0;

  constructor(proc: PipedProcess, opts: JsonRpcConnectionOptions = {}) {
    this.#proc = proc;
    this.#opts = opts;
    const readDone = this.#readLoop();
    void drain(proc.stderr);
    // Dispatch whatever stdout still holds before reporting the exit, but do
    // not wait forever if a grandchild keeps the pipe open.
    const settled = (code: number | null) =>
      Promise.race([readDone, delay(STDOUT_DRAIN_MS)]).then(() => this.#onExit({ code }));
    this.#exited = proc.exited.then(settled, () => settled(null));
  }

  get closed(): boolean {
    return this.#closed;
  }

  /** Resolves when the process has exited. */
  get exited(): Promise<ProcessExit> {
    return this.#exited;
  }

  /** Call `method` and wait for its result; rejects with `RpcError`. */
  request(method: string, params?: unknown, timeoutMs?: number): Promise<unknown> {
    if (this.#closed) return Promise.reject(new RpcError(RPC_CLOSED, "connection closed", method));
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      const ms = timeoutMs ?? this.#opts.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS;
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new RpcError(RPC_TIMEOUT, `timed out after ${ms} ms`, method));
      }, ms);
      this.#pending.set(id, { method, resolve, reject, timer });
      const message = params === undefined ? { method, id } : { method, id, params };
      this.#send(message).catch((error) => {
        clearTimeout(timer);
        this.#pending.delete(id);
        reject(error);
      });
    });
  }

  notify(method: string, params?: unknown): Promise<void> {
    return this.#send(params === undefined ? { method } : { method, params });
  }

  /** Answer a server-initiated request. */
  respond(id: RpcId, result: unknown): Promise<void> {
    return this.#send({ id, result });
  }

  respondError(id: RpcId, error: RpcErrorBody): Promise<void> {
    return this.#send({ id, error });
  }

  /**
   * Stop the server: SIGTERM, then SIGKILL after a grace period. Pending
   * requests reject with `RPC_CLOSED`. Idempotent.
   */
  async close(graceMs = SHUTDOWN_GRACE_MS): Promise<ProcessExit> {
    if (!this.#closed) {
      this.#closed = true;
      this.#rejectAll("connection closed");
      this.#proc.kill("SIGTERM");
      const timer = setTimeout(() => this.#proc.kill("SIGKILL"), graceMs);
      await this.#exited;
      clearTimeout(timer);
    }
    return this.#exited;
  }

  async #send(message: object): Promise<void> {
    if (this.#closed) throw new RpcError(RPC_CLOSED, "connection closed");
    await this.#proc.write(`${JSON.stringify(message)}\n`);
  }

  async #readLoop(): Promise<void> {
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      for await (const chunk of this.#proc.stdout) {
        buffer += decoder.decode(chunk, { stream: true });
        for (let nl = buffer.indexOf("\n"); nl >= 0; nl = buffer.indexOf("\n")) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (line) this.#dispatch(line);
        }
      }
      if (buffer.trim()) this.#dispatch(buffer.trim());
    } catch {
      // stdout closed abruptly; exit handling covers the rest.
    }
  }

  #dispatch(line: string): void {
    let msg: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(line);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw 0;
      msg = parsed as Record<string, unknown>;
    } catch {
      this.malformedLines++;
      return;
    }
    const id = msg.id;
    const hasId = typeof id === "string" || typeof id === "number";
    const method = typeof msg.method === "string" ? msg.method : undefined;
    if (method !== undefined && hasId) {
      this.#opts.onRequest?.({ id, method, params: msg.params });
    } else if (method !== undefined) {
      this.#opts.onNotification?.(method, msg.params);
    } else if (hasId && ("result" in msg || "error" in msg)) {
      this.#settle(id, msg);
    } else {
      this.malformedLines++;
    }
  }

  #settle(id: RpcId, msg: Record<string, unknown>): void {
    const pending = this.#pending.get(id);
    if (!pending) return;
    this.#pending.delete(id);
    clearTimeout(pending.timer);
    const error = msg.error as Partial<RpcErrorBody> | undefined;
    if (error && typeof error === "object") {
      pending.reject(
        new RpcError(error.code ?? -32603, error.message ?? "unknown error", pending.method),
      );
    } else {
      pending.resolve(msg.result);
    }
  }

  #rejectAll(reason: string): void {
    for (const [id, pending] of this.#pending) {
      clearTimeout(pending.timer);
      pending.reject(new RpcError(RPC_CLOSED, reason, pending.method));
      this.#pending.delete(id);
    }
  }

  #onExit(exit: ProcessExit): ProcessExit {
    this.#closed = true;
    this.#rejectAll("app-server exited");
    this.#opts.onExit?.(exit);
    return exit;
  }
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Read and discard a stream so the child never blocks on a full pipe. */
async function drain(stream: ReadableStream<Uint8Array>): Promise<void> {
  try {
    for await (const _ of stream) {
      // discarded: stderr may contain paths and request details; never logged.
    }
  } catch {
    // ignore
  }
}
