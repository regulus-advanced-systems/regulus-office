/**
 * `AgentControl` over one `codex app-server` process (stdio JSON-RPC) started
 * in the human's runner through `RunnerOps.spawnPiped` (SPEC §7, §8).
 *
 * Lifecycle: spawn → `initialize`/`initialized` → `thread/start` (or
 * `thread/resume` when the plan carries a thread id) → `turn/start` per
 * prompt (`turn/steer` while a turn is running) → `close()` stops the process.
 * The thread id is the provider session id stored on the agent row.
 */
import type { AgentEvent, PermissionDecision } from "@regulus/protocol";
import { AsyncQueue } from "../async-queue.ts";
import type {
  AgentControl,
  PermissionResolvedListener,
  PromptAttachment,
  RunnerContext,
  SpawnPlan,
} from "../types.ts";
import { approvalResponse } from "./approvals.ts";
import { type ApprovalRequest, CodexEventMapper, isApprovalRequest } from "./events.ts";
import type { AskForApproval, ThreadStartParams, UserInput } from "./generated/v2/index.ts";
import { clip } from "./items.ts";
import { RPC_METHOD_NOT_FOUND } from "./jsonrpc.ts";
import { type CodexNotification, CodexRpcClient, type CodexServerRequest } from "./rpc.ts";
import { limitSamplesFromRead } from "./usage.ts";

export interface CodexControlOptions {
  /** Defaults for `thread/start` (the office default is on-request approvals in a workspace-write sandbox). */
  threadStart?: Partial<ThreadStartParams>;
  requestTimeoutMs?: number;
  /** `thread/start` / `thread/resume` can wait on MCP server startup. */
  threadTimeoutMs?: number;
}

export const DEFAULT_THREAD_START: Partial<ThreadStartParams> = {
  approvalPolicy: "on-request",
  sandbox: "workspace-write",
  serviceName: "regulus_office",
};

const THREAD_TIMEOUT_MS = 120_000;

export class CodexControl implements AgentControl {
  readonly #plan: SpawnPlan;
  readonly #ctx: RunnerContext;
  readonly #opts: CodexControlOptions;
  readonly #queue = new AsyncQueue<AgentEvent>();
  readonly #mapper = new CodexEventMapper();
  readonly #pending = new Map<string, { rpcId: string | number; req: ApprovalRequest }>();
  readonly #resolvedListeners = new Set<PermissionResolvedListener>();
  readonly #ready: Promise<CodexRpcClient>;
  #client: CodexRpcClient | undefined;
  #closing = false;

  constructor(plan: SpawnPlan, ctx: RunnerContext, opts: CodexControlOptions = {}) {
    this.#plan = plan;
    this.#ctx = ctx;
    this.#opts = opts;
    this.#emit({ kind: "status", ts: ctx.now(), status: "starting" });
    this.#ready = this.#start();
    this.#ready.catch(() => {});
  }

  get events(): AsyncIterable<AgentEvent> {
    return this.#queue;
  }

  /** Resolves once the thread is ready (rejects if startup failed). */
  async ready(): Promise<void> {
    await this.#ready;
  }

  providerSessionId(): string | undefined {
    return this.#mapper.threadId ?? this.#plan.providerSessionId;
  }

  /** Each approval leaves `#pending` on its own: answered here or cleared by the server. */
  onPermissionResolved(listener: PermissionResolvedListener): () => void {
    this.#resolvedListeners.add(listener);
    return () => this.#resolvedListeners.delete(listener);
  }

  #resolved(requestId: string): void {
    for (const listener of [...this.#resolvedListeners]) listener(requestId);
  }

  /** Approval requests surfaced and not yet answered. */
  pendingPermissions(): string[] {
    return [...this.#pending.keys()];
  }

  async prompt(text: string, attachments: readonly PromptAttachment[] = []): Promise<void> {
    const client = await this.#open();
    const threadId = this.#mapper.threadId as string;
    const input: UserInput[] = [{ type: "text", text, text_elements: [] }];
    for (const a of attachments) {
      input.push(
        a.mimeType.startsWith("image/")
          ? { type: "localImage", path: a.path }
          : { type: "mention", name: a.name, path: a.path },
      );
    }
    const turnId = this.#mapper.activeTurnId;
    if (turnId) {
      await client.request("turn/steer", { threadId, input, expectedTurnId: turnId });
      return;
    }
    const res = await client.request("turn/start", { threadId, input });
    if (res.turn.status === "inProgress") this.#mapper.activeTurnId = res.turn.id;
  }

  async respondPermission(id: string, decision: PermissionDecision): Promise<void> {
    const client = await this.#open();
    const pending = this.#pending.get(id);
    if (!pending) throw new Error(`Unknown permission request: ${id}`);
    this.#pending.delete(id);
    this.#resolved(id);
    await client.respond(pending.rpcId, approvalResponse(pending.req, decision));
    this.#emit({ kind: "status", ts: this.#ctx.now(), status: "working" });
  }

  async interrupt(): Promise<void> {
    const client = await this.#open();
    const turnId = this.#mapper.activeTurnId;
    if (!turnId) return;
    await client.request("turn/interrupt", { threadId: this.#mapper.threadId as string, turnId });
  }

  /** Stop the app-server (SIGTERM, then SIGKILL). Emits `exit` and ends `events`. Idempotent. */
  async close(): Promise<void> {
    if (this.#closing) return;
    this.#closing = true;
    if (this.#client) {
      await this.#client.close();
    } else {
      this.#finish(undefined, "closed before start");
    }
  }

  async #open(): Promise<CodexRpcClient> {
    if (this.#closing) throw new Error("Agent control is closed");
    const client = await this.#ready;
    if (client.connection.closed) throw new Error("Codex app-server has exited");
    return client;
  }

  async #start(): Promise<CodexRpcClient> {
    const proc = await this.#ctx.runner.spawnPiped(this.#plan).catch((error: unknown) => {
      this.#emit({ kind: "status", ts: this.#ctx.now(), status: "error", reason: reason(error) });
      this.#finish(undefined, "spawn failed");
      throw error;
    });
    if (this.#closing) {
      proc.kill("SIGKILL");
      throw new Error("Agent control is closed");
    }
    const client = new CodexRpcClient(proc, {
      requestTimeoutMs: this.#opts.requestTimeoutMs,
      onNotification: (n) => this.#onNotification(n),
      onServerRequest: (r) => this.#onServerRequest(r),
      onExit: (exit) => this.#finish(exit.code, this.#closing ? "closed" : "app-server exited"),
    });
    this.#client = client;
    try {
      await client.initialize();
      const timeout = this.#opts.threadTimeoutMs ?? THREAD_TIMEOUT_MS;
      const resumeId = this.#plan.providerSessionId;
      // The robot's approval policy (#166) on both, so a resume keeps it.
      const approval = this.#approvalPolicy();
      const res = resumeId
        ? await client.request(
            "thread/resume",
            { threadId: resumeId, cwd: this.#plan.cwd, ...approval },
            timeout,
          )
        : await client.request(
            "thread/start",
            {
              ...DEFAULT_THREAD_START,
              ...this.#opts.threadStart,
              ...approval,
              cwd: this.#plan.cwd,
            },
            timeout,
          );
      this.#mapper.threadId = res.thread.id;
      this.#emit({ kind: "status", ts: this.#ctx.now(), status: "idle" });
      void this.#readLimits(client);
      return client;
    } catch (error) {
      this.#emit({ kind: "status", ts: this.#ctx.now(), status: "error", reason: reason(error) });
      await this.close();
      throw error;
    }
  }

  /** `approvalPolicy` from the plan (validated by `buildSpawn`); none = the defaults. */
  #approvalPolicy(): { approvalPolicy?: AskForApproval } {
    const mode = this.#plan.permissionMode;
    return mode === "on-request" || mode === "never" ? { approvalPolicy: mode } : {};
  }

  /** Best effort: API-key accounts have no ChatGPT limits and get an error. */
  async #readLimits(client: CodexRpcClient): Promise<void> {
    try {
      const res = await client.request("account/rateLimits/read", undefined);
      const ts = this.#ctx.now();
      for (const s of limitSamplesFromRead(res, ts)) this.#emit({ kind: "limit", ts, ...s });
    } catch {
      // not signed in with ChatGPT, or closed meanwhile
    }
  }

  #onNotification(n: CodexNotification): void {
    if (n.method === "serverRequest/resolved") {
      // Cleared by the server (turn finished or interrupted before we answered).
      for (const [id, p] of this.#pending) {
        if (p.rpcId !== n.params.requestId) continue;
        this.#pending.delete(id);
        this.#resolved(id);
      }
    }
    for (const event of this.#mapper.map(n, this.#ctx.now())) this.#emit(event);
  }

  #onServerRequest(req: CodexServerRequest): void {
    const client = this.#client;
    if (!client) return;
    if (isApprovalRequest(req)) {
      const requestId = String(req.id);
      this.#pending.set(requestId, { rpcId: req.id, req });
      const ts = this.#ctx.now();
      this.#emit(this.#mapper.permissionRequest(requestId, req, ts));
      this.#emit({ kind: "status", ts, status: "waiting_permission" });
      return;
    }
    if (req.method === "mcpServer/elicitation/request") {
      void client
        .respond(req.id, { action: "decline", content: null, _meta: null })
        .catch(() => {});
      return;
    }
    // Token refresh, dynamic tools, user-input prompts, attestation: not offered
    // by the office (it never handles ChatGPT tokens, SPEC §8 rule 1).
    void client
      .respondError(req.id, {
        code: RPC_METHOD_NOT_FOUND,
        message: `${req.method} is not supported by this client`,
      })
      .catch(() => {});
  }

  #finish(code: number | null | undefined, why: string): void {
    if (this.#queue.ended) return;
    this.#closing = true;
    this.#pending.clear();
    this.#emit({
      kind: "exit",
      ts: this.#ctx.now(),
      ...(typeof code === "number" ? { code } : {}),
      reason: why,
    });
    this.#queue.end();
  }

  #emit(event: AgentEvent): void {
    if (!this.#queue.ended) this.#queue.push(event);
  }
}

function reason(error: unknown): string {
  return clip(error instanceof Error ? error.message : String(error), 500);
}
