/**
 * HTTP client for the API server of a running Hermes Agent gateway (#58).
 *
 * The wire format is Hermes's own, read from its documentation and source at
 * release v2026.9.24 (hermes-agent 0.21.5, `gateway/platforms/api_server.py`):
 *
 *   GET  /health                           no auth  { status, platform: "hermes-agent", version }
 *   GET  /v1/capabilities                  Bearer   { features: { session_chat_streaming, ... } }
 *   POST /api/sessions                     Bearer   201 { session: { id, ... } }
 *   POST /api/sessions/{id}/chat/stream    Bearer   SSE: run.started, message.started,
 *        assistant.delta, assistant.commentary, tool.started|completed|failed, tool.progress,
 *        assistant.completed { content }, run.completed|failed|cancelled, error, done;
 *        `: keepalive` comments every 10 s
 *   GET  /v1/runs/{run_id}                 Bearer   { status, output, session_id }
 *
 * Errors are `{ error: { message, type, code } }`: 401 `gateway_auth_failed`,
 * 404 `session_not_found`, 429 with `Retry-After` when Hermes runs too many
 * turns at once.
 *
 * Nothing here logs, and no error text holds the address or the token.
 */
import type { HermesConnection } from "./connections.ts";
import { type SseEvent, SseParser } from "./sse.ts";

export type HermesFailure =
  /** Nothing answered: refused, timed out, DNS, TLS. */
  | "unreachable"
  /** The gateway refused the access token. */
  | "auth"
  /** The session (or run) is not there. */
  | "not_found"
  /** Too many turns at once; try again shortly. */
  | "busy"
  /** Something answered that does not speak Hermes's protocol. */
  | "not_hermes"
  /** A Hermes without the session chat the office uses. */
  | "too_old"
  /** The stream ended or stalled before the turn did. */
  | "broken_stream"
  | "http";

export class HermesError extends Error {
  override name = "HermesError";
  constructor(
    readonly kind: HermesFailure,
    message: string,
    readonly detail: { status?: number; code?: string; retryAfterMs?: number } = {},
  ) {
    super(message);
  }
}

export interface HermesClientOptions {
  fetch?: typeof fetch;
  /** For requests that answer at once (health, sessions). */
  requestTimeoutMs?: number;
  /** How long a stream may stay silent; Hermes sends a keepalive every 10 s. */
  streamIdleMs?: number;
}

export interface HermesStreamEvent {
  event: string;
  data: Record<string, unknown>;
}

export interface HermesRunStatus {
  status: string;
  output?: string;
  sessionId?: string;
}

const asRecord = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

export class HermesClient {
  readonly #fetch: typeof fetch;
  readonly #requestTimeoutMs: number;
  readonly #streamIdleMs: number;

  constructor(
    private readonly connection: HermesConnection,
    options: HermesClientOptions = {},
  ) {
    this.#fetch = options.fetch ?? fetch;
    this.#requestTimeoutMs = options.requestTimeoutMs ?? 10_000;
    this.#streamIdleMs = options.streamIdleMs ?? 45_000;
  }

  /** Is a Hermes there, does it take the token, and can it do what the office needs? */
  async probe(signal?: AbortSignal): Promise<{ version?: string }> {
    const health = await this.#request("GET", "/health", { auth: false, signal });
    const body = health.ok ? asRecord(await health.json().catch(() => null)) : {};
    if (body.platform !== "hermes-agent") {
      throw new HermesError("not_hermes", "what answers at that address is not a Hermes gateway");
    }
    const version = typeof body.version === "string" ? body.version.slice(0, 40) : undefined;
    const caps = await this.#request("GET", "/v1/capabilities", { signal });
    if (caps.status === 404) throw tooOld();
    await this.#expectOk(caps);
    const features = asRecord(asRecord(await caps.json().catch(() => null)).features);
    if (features.session_chat_streaming !== true) throw tooOld();
    return version ? { version } : {};
  }

  /** A new, empty session. A title that is taken is dropped, not fought over. */
  async createSession(title?: string, signal?: AbortSignal): Promise<string> {
    let res = await this.#request("POST", "/api/sessions", {
      body: title ? { title } : {},
      signal,
    });
    if (res.status === 400 && title) {
      res = await this.#request("POST", "/api/sessions", { body: {}, signal });
    }
    await this.#expectOk(res);
    const id = asRecord(asRecord(await res.json().catch(() => null)).session).id;
    if (typeof id !== "string" || !id) {
      throw new HermesError("not_hermes", "Hermes did not name the session it created");
    }
    return id;
  }

  async sessionExists(sessionId: string, signal?: AbortSignal): Promise<boolean> {
    const res = await this.#request("GET", `/api/sessions/${encodeURIComponent(sessionId)}`, {
      signal,
    });
    if (res.status === 404) return false;
    await this.#expectOk(res);
    return true;
  }

  /**
   * Run one turn in a session and hand over its events as they arrive.
   * Resolves when Hermes ended the stream (`done`); throws `broken_stream`
   * when the connection ended or went silent first. A failure before the
   * first byte (`unreachable`, `auth`, `not_found`, `busy`) means Hermes did
   * not take the message.
   */
  async chat(
    sessionId: string,
    body: { message: string; system_message?: string },
    onEvent: (event: HermesStreamEvent) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    const abort = new AbortController();
    const onAbort = () => abort.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) abort.abort();
    let idle: ReturnType<typeof setTimeout> | undefined;
    let stalled = false;
    const touch = () => {
      clearTimeout(idle);
      idle = setTimeout(() => {
        stalled = true;
        abort.abort();
      }, this.#streamIdleMs);
    };
    try {
      touch();
      const res = await this.#request(
        "POST",
        `/api/sessions/${encodeURIComponent(sessionId)}/chat/stream`,
        { body, signal: abort.signal, accept: "text/event-stream", timeout: false },
      );
      await this.#expectOk(res);
      if (!res.body) throw new HermesError("broken_stream", "Hermes sent no answer stream");
      const parser = new SseParser();
      const decoder = new TextDecoder();
      const reader = res.body.getReader();
      let done = false;
      try {
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          touch();
          for (const frame of parser.push(decoder.decode(chunk.value, { stream: true }))) {
            const event = decode(frame);
            if (!event) continue;
            if (event.event === "done") done = true;
            else onEvent(event);
          }
        }
      } catch {
        if (signal?.aborted) throw new HermesError("broken_stream", "stopped");
        throw new HermesError(
          "broken_stream",
          stalled
            ? "Hermes went silent in the middle of its answer"
            : "the connection to Hermes broke in the middle of its answer",
        );
      } finally {
        reader.releaseLock();
      }
      if (!done) {
        throw new HermesError(
          "broken_stream",
          "the connection to Hermes ended before its answer did",
        );
      }
    } finally {
      clearTimeout(idle);
      signal?.removeEventListener("abort", onAbort);
    }
  }

  /** What became of a run whose stream was lost; null when Hermes no longer knows it. */
  async runStatus(runId: string, signal?: AbortSignal): Promise<HermesRunStatus | null> {
    const res = await this.#request("GET", `/v1/runs/${encodeURIComponent(runId)}`, { signal });
    if (res.status === 404) return null;
    await this.#expectOk(res);
    const body = asRecord(await res.json().catch(() => null));
    return {
      status: typeof body.status === "string" ? body.status : "",
      ...(typeof body.output === "string" ? { output: body.output } : {}),
      ...(typeof body.session_id === "string" ? { sessionId: body.session_id } : {}),
    };
  }

  async #request(
    method: string,
    path: string,
    options: {
      auth?: boolean;
      body?: unknown;
      signal?: AbortSignal;
      accept?: string;
      /** False: the caller bounds the request itself (a stream). */
      timeout?: boolean;
    } = {},
  ): Promise<Response> {
    const signals = [
      ...(options.signal ? [options.signal] : []),
      ...(options.timeout === false ? [] : [AbortSignal.timeout(this.#requestTimeoutMs)]),
    ];
    try {
      return await this.#fetch(`${this.connection.url}${path}`, {
        method,
        headers: {
          accept: options.accept ?? "application/json",
          ...(options.body !== undefined ? { "content-type": "application/json" } : {}),
          ...(options.auth === false
            ? {}
            : { authorization: `Bearer ${this.connection.token.reveal()}` }),
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        // A gateway never redirects; following one could carry the token elsewhere.
        redirect: "error",
        signal: signals.length > 0 ? AbortSignal.any(signals) : undefined,
      });
    } catch {
      // Never the cause: it can hold the address.
      throw new HermesError("unreachable", "the Hermes gateway cannot be reached");
    }
  }

  async #expectOk(res: Response): Promise<void> {
    if (res.ok) return;
    const error = asRecord(asRecord(await res.json().catch(() => null)).error);
    const code = typeof error.code === "string" ? error.code.slice(0, 60) : undefined;
    const detail = { status: res.status, ...(code ? { code } : {}) };
    if (res.status === 401 || res.status === 403) {
      throw new HermesError("auth", "the Hermes gateway refused the access token", detail);
    }
    if (res.status === 404) {
      throw new HermesError("not_found", "Hermes does not know that session", detail);
    }
    if (res.status === 429) {
      const seconds = Number(res.headers.get("retry-after"));
      throw new HermesError("busy", "Hermes is running too many turns at once", {
        ...detail,
        retryAfterMs: Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 1000,
      });
    }
    throw new HermesError("http", `Hermes answered with an error (HTTP ${res.status})`, detail);
  }
}

const tooOld = () =>
  new HermesError(
    "too_old",
    "this Hermes is too old for the office: it has no session chat. Update Hermes and try again",
  );

function decode(frame: SseEvent): HermesStreamEvent | null {
  try {
    return { event: frame.event, data: asRecord(JSON.parse(frame.data)) };
  } catch {
    return null;
  }
}
