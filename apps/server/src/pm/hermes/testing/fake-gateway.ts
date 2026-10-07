/**
 * A fake Hermes gateway for tests (#58). It speaks the part of the Hermes
 * API server's wire protocol the office uses, as read from Hermes's source
 * at release v2026.9.24 (`gateway/platforms/api_server.py`): the same paths,
 * the same Bearer check and error bodies, and the same SSE frames
 * (`event:` + `data:` JSON stamped with `session_id`, `run_id`, `seq`, `ts`).
 * It is not Hermes: there is no model behind it, and it has never been
 * compared with a running instance.
 *
 * A test scripts what the next turns do (`next`), takes the gateway down and
 * up again on the same port, and reads back what it was sent.
 */
export type FakeTurn =
  /** Answer normally (the default). */
  | { kind: "reply"; text?: string; tools?: string[]; moveTo?: string }
  /** End the turn as failed, optionally after some text. */
  | { kind: "failed"; text?: string; reason?: string }
  /** An `error` event instead of an answer. */
  | { kind: "error"; message: string }
  /** 429, as when Hermes runs too many turns. */
  | { kind: "busy" }
  /** Cut the stream after the first delta; `finishes`: the run still completes on the gateway. */
  | { kind: "drop"; finishes?: string }
  /** Start the stream and then say nothing more. */
  | { kind: "stall" }
  /** Another Hermes window holds the conversation. */
  | { kind: "queued" };

export interface FakeRequest {
  method: string;
  path: string;
  authorization: string | null;
  body: unknown;
}

export interface FakeSession {
  id: string;
  source: string;
  title?: string;
  /** What reached the session: user and assistant messages, in order. */
  messages: Array<{ role: "user" | "assistant"; content: string; system?: string }>;
}

export interface FakeGatewayOptions {
  key?: string;
  version?: string;
  /** False: an old Hermes without session chat. */
  sessionChat?: boolean;
  /** Not a Hermes at all: `/health` answers something else. */
  impostor?: boolean;
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
const error = (message: string, status: number, code: string, type = "invalid_request_error") =>
  json({ error: { message, type, param: null, code } }, status);

export class FakeHermesGateway {
  /** The `API_SERVER_KEY`; a test may change it, as an owner rotating the key would. */
  key: string;
  readonly sessions = new Map<string, FakeSession>();
  readonly requests: FakeRequest[] = [];
  readonly runs = new Map<string, Record<string, unknown>>();
  /** What the next turns do, first in first out; empty: a normal reply. */
  readonly next: FakeTurn[] = [];
  #server: ReturnType<typeof Bun.serve> | undefined;
  #port = 0;
  #counter = 0;
  readonly #open = new Set<ReadableStreamDefaultController<Uint8Array>>();

  constructor(private readonly options: FakeGatewayOptions = {}) {
    this.key = options.key ?? "fake-hermes-key-0123456789abcdef";
  }

  get url(): string {
    return `http://127.0.0.1:${this.#port}`;
  }

  /** Start listening (again on the same port after `down`). */
  up(): this {
    if (this.#server) return this;
    this.#server = Bun.serve({
      hostname: "127.0.0.1",
      port: this.#port,
      idleTimeout: 0,
      fetch: (request) => this.#handle(request),
    });
    this.#port = this.#server.port ?? this.#port;
    return this;
  }

  /** Stop listening and cut every open stream, like a gateway that was killed. */
  async down(): Promise<void> {
    for (const controller of this.#open) {
      try {
        controller.error(new Error("gateway down"));
      } catch {
        // Already closed.
      }
    }
    this.#open.clear();
    await this.#server?.stop(true);
    this.#server = undefined;
  }

  /** A session that exists already, e.g. the one a Telegram chat uses. */
  seed(id: string, source: string): FakeSession {
    const session: FakeSession = { id, source, messages: [] };
    this.sessions.set(id, session);
    return session;
  }

  /** The turns that reached any session, as the texts people sent. */
  received(): string[] {
    return [...this.sessions.values()].flatMap((s) =>
      s.messages.filter((m) => m.role === "user").map((m) => m.content),
    );
  }

  async #handle(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url);
    const body: unknown =
      request.method === "GET" ? undefined : await request.json().catch(() => null);
    this.requests.push({
      method: request.method,
      path: pathname,
      authorization: request.headers.get("authorization"),
      body,
    });
    const version = this.options.version ?? "0.21.5";
    if (pathname === "/health" || pathname === "/v1/health") {
      return this.options.impostor
        ? json({ ok: true })
        : json({ status: "ok", platform: "hermes-agent", version });
    }
    // Everything else needs the key, exactly as Hermes checks it.
    if (request.headers.get("authorization") !== `Bearer ${this.key}`) {
      return error(
        "Invalid gateway API key (API_SERVER_KEY)",
        401,
        "gateway_auth_failed",
        "gateway_auth_error",
      );
    }
    const chat = this.options.sessionChat !== false;
    if (request.method === "GET" && pathname === "/v1/capabilities") {
      return json({
        object: "hermes.api_server.capabilities",
        platform: "hermes-agent",
        auth: { type: "bearer", required: true },
        features: {
          session_resources: chat,
          session_chat: chat,
          session_chat_streaming: chat,
          run_status: true,
          session_continuity_header: "X-Hermes-Session-Id",
        },
      });
    }
    if (request.method === "POST" && pathname === "/api/sessions") {
      const input = (body ?? {}) as { id?: string; title?: string };
      const id = input.id ?? `api_${Date.now()}_${(++this.#counter).toString(16).padStart(8, "0")}`;
      if (this.sessions.has(id))
        return error(`Session already exists: ${id}`, 409, "session_exists");
      if (input.title && [...this.sessions.values()].some((s) => s.title === input.title)) {
        return error("Title already in use by session", 400, "invalid_title");
      }
      const session: FakeSession = { id, source: "api_server", messages: [] };
      if (input.title) session.title = input.title;
      this.sessions.set(id, session);
      return json({ object: "hermes.session", session: this.#sessionView(session) }, 201);
    }
    const run = /^\/v1\/runs\/([^/]+)$/.exec(pathname);
    if (request.method === "GET" && run) {
      const status = this.runs.get(decodeURIComponent(run[1] ?? ""));
      return status ? json(status) : error("Run not found", 404, "run_not_found");
    }
    const match = /^\/api\/sessions\/([^/]+)(\/chat\/stream)?$/.exec(pathname);
    if (!match) return error("Not found", 404, "not_found");
    const session = this.sessions.get(decodeURIComponent(match[1] ?? ""));
    if (!session) {
      return error(`Session not found: ${match[1]}`, 404, "session_not_found");
    }
    if (request.method === "GET" && !match[2]) {
      return json({ object: "hermes.session", session: this.#sessionView(session) });
    }
    if (request.method === "POST" && match[2]) {
      const input = (body ?? {}) as { message?: string; input?: string; system_message?: string };
      const message = input.message ?? input.input;
      if (!message) return error("Missing 'message' field", 400, "missing_message");
      return this.#stream(session, message, input.system_message);
    }
    return error("Not found", 404, "not_found");
  }

  #sessionView(session: FakeSession) {
    return {
      id: session.id,
      source: session.source,
      title: session.title ?? null,
      message_count: session.messages.length,
      has_system_prompt: false,
      has_model_config: false,
    };
  }

  #stream(session: FakeSession, message: string, system: string | undefined): Response {
    const turn = this.next.shift() ?? { kind: "reply" as const };
    if (turn.kind === "busy") {
      return json(
        {
          error: {
            message: "Too many concurrent runs (max 10)",
            type: "rate_limit_error",
            param: null,
            code: "rate_limit_exceeded",
          },
        },
        429,
        { "retry-after": "1" },
      );
    }
    // As in Hermes: the message is in the transcript once the turn starts.
    session.messages.push({ role: "user", content: message, ...(system ? { system } : {}) });
    const runId = `run_${(++this.#counter).toString(16).padStart(8, "0")}`;
    const messageId = `msg_${this.#counter}`;
    this.runs.set(runId, { object: "hermes.run", run_id: runId, status: "running" });
    const encoder = new TextEncoder();
    let seq = 0;
    const frame = (event: string, data: Record<string, unknown>) =>
      encoder.encode(
        `event: ${event}\ndata: ${JSON.stringify({
          ...data,
          session_id: data.session_id ?? session.id,
          run_id: runId,
          seq: ++seq,
          ts: Date.now() / 1000,
        })}\n\n`,
      );
    const finish = (status: string, output: string, sessionId = session.id) =>
      this.runs.set(runId, {
        object: "hermes.run",
        run_id: runId,
        status,
        output,
        session_id: sessionId,
      });
    const open = this.#open;
    const body = new ReadableStream<Uint8Array>({
      start: (controller) => {
        open.add(controller);
        const send = (event: string, data: Record<string, unknown>) =>
          controller.enqueue(frame(event, data));
        const end = () => {
          open.delete(controller);
          controller.close();
        };
        send("run.started", { user_message: { role: "user", content: message }, runtime: {} });
        controller.enqueue(encoder.encode(": keepalive\n\n"));
        send("message.started", { message: { id: messageId, role: "assistant" } });
        if (turn.kind === "stall") return;
        if (turn.kind === "queued") {
          send("run.queued", { status: "queued", delivery_id: "d1" });
          send("done", {});
          return end();
        }
        if (turn.kind === "error") {
          finish("failed", "");
          send("error", { message: turn.message });
          send("done", {});
          return end();
        }
        const text =
          turn.kind === "drop"
            ? (turn.finishes ?? "")
            : (turn.text ?? (turn.kind === "reply" ? `Hermes heard: ${message}` : ""));
        if (turn.kind === "reply") {
          for (const tool of turn.tools ?? []) {
            send("tool.started", { message_id: messageId, tool_name: tool, preview: "", args: {} });
            send("tool.completed", { message_id: messageId, tool_name: tool, preview: "ok" });
          }
        }
        const half = Math.ceil(text.length / 2);
        if (text) send("assistant.delta", { message_id: messageId, delta: text.slice(0, half) });
        if (turn.kind === "drop") {
          // The office's connection is gone; a real Hermes interrupts the run, unless it had finished.
          if (turn.finishes) {
            session.messages.push({ role: "assistant", content: turn.finishes });
            finish("completed", turn.finishes);
          } else finish("cancelled", "");
          // After the frames above went out, as a connection lost mid-answer.
          setTimeout(() => {
            open.delete(controller);
            try {
              controller.error(new Error("stream cut"));
            } catch {
              // Already closed by `down`.
            }
          }, 10);
          return;
        }
        if (text) send("assistant.delta", { message_id: messageId, delta: text.slice(half) });
        const effective = turn.kind === "reply" && turn.moveTo ? turn.moveTo : session.id;
        if (effective !== session.id) this.seed(effective, session.source);
        const failed = turn.kind === "failed";
        const fields = {
          completed: !failed,
          partial: false,
          interrupted: false,
          ...(failed && turn.reason ? { turn_exit_reason: turn.reason } : {}),
        };
        if (text) session.messages.push({ role: "assistant", content: text });
        send("assistant.completed", {
          session_id: effective,
          message_id: messageId,
          content: text,
          ...fields,
          runtime: {},
        });
        send(failed ? "run.failed" : "run.completed", {
          session_id: effective,
          message_id: messageId,
          ...fields,
          messages: [],
          usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
          runtime: {},
        });
        finish(failed ? "failed" : "completed", text, effective);
        send("done", {});
        end();
      },
      cancel: () => {
        // The client went away: Hermes interrupts the run.
        if (this.runs.get(runId)?.status === "running") finish("cancelled", "");
      },
    });
    return new Response(body, {
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        "x-hermes-session-id": session.id,
      },
    });
  }
}
