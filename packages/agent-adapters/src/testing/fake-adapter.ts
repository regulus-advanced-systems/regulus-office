/**
 * Scripted `AgentAdapter` for server tests (AgentManager, hook routes, rooms).
 * It never talks to a real provider: `connect` replays a scripted event list,
 * `prompt` replies via `onPrompt`, and every call is recorded for assertions.
 * It never logs, and records `SpawnPlan`s as-is (their env redacts itself).
 */
import {
  AgentEvent,
  type LimitSample,
  type PermissionDecision,
  type ProviderId,
  type UsageSample,
} from "@regulus/protocol";
import { AsyncQueue } from "../async-queue.ts";
import { Secret, SecretEnv } from "../secret.ts";
import { tmuxSessionName } from "../session.ts";
import type {
  AdapterCapabilities,
  AgentAdapter,
  AgentControl,
  AgentRecord,
  LoginFlowPlan,
  OutOfBandInput,
  PlannedFile,
  PromptAttachment,
  RunnerContext,
  SpawnPlan,
  SpawnRequest,
} from "../types.ts";

export interface FakeAdapterOptions {
  id?: ProviderId;
  capabilities?: Partial<AdapterCapabilities>;
  /** argv of the spawned program (e.g. the fake agent script in server tests). */
  command?: readonly string[];
  /** Events emitted right after `connect`. */
  script?: readonly AgentEvent[];
  /** Events emitted in reply to each prompt. */
  onPrompt?: (text: string, now: number) => readonly AgentEvent[];
  login?: LoginFlowPlan;
  usage?: readonly (UsageSample | LimitSample)[];
  providerSessionId?: string;
}

const DEFAULT_CAPABILITIES: AdapterCapabilities = {
  structured: true,
  attachTui: true,
  coDrive: false,
  resume: true,
  usageInband: true,
  limits: false,
  deviceLogin: false,
};

export class FakeControl implements AgentControl {
  readonly prompts: { text: string; attachments: readonly PromptAttachment[] }[] = [];
  readonly permissionResponses: { id: string; decision: PermissionDecision }[] = [];
  interrupts = 0;
  closed = false;
  readonly #queue = new AsyncQueue<AgentEvent>();
  readonly #pending = new Set<string>();

  constructor(
    readonly plan: SpawnPlan,
    private readonly ctx: RunnerContext,
    private readonly onPrompt: FakeAdapterOptions["onPrompt"],
    private readonly sessionId: string | undefined,
  ) {}

  get events(): AsyncIterable<AgentEvent> {
    return this.#queue;
  }

  /** Push an event as if the provider had sent it. */
  emit(event: AgentEvent): void {
    if (event.kind === "permission_request") this.#pending.add(event.requestId);
    this.#queue.push(event);
  }

  /** Permission requests emitted and not yet answered. */
  pendingPermissions(): string[] {
    return [...this.#pending];
  }

  async prompt(text: string, attachments: readonly PromptAttachment[] = []): Promise<void> {
    this.#assertOpen();
    this.prompts.push({ text, attachments });
    for (const event of this.onPrompt?.(text, this.ctx.now()) ?? []) this.emit(event);
  }

  async respondPermission(id: string, decision: PermissionDecision): Promise<void> {
    this.#assertOpen();
    if (!this.#pending.delete(id)) throw new Error(`Unknown permission request: ${id}`);
    this.permissionResponses.push({ id, decision });
    this.emit({ kind: "status", ts: this.ctx.now(), status: "working" });
  }

  async interrupt(): Promise<void> {
    this.#assertOpen();
    this.interrupts++;
    this.emit({ kind: "status", ts: this.ctx.now(), status: "idle", reason: "interrupted" });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.#queue.push({ kind: "exit", ts: this.ctx.now(), code: 0 });
    this.#queue.end();
  }

  providerSessionId(): string | undefined {
    return this.sessionId;
  }

  #assertOpen(): void {
    if (this.closed) throw new Error("Agent control is closed");
  }
}

export class FakeAdapter implements AgentAdapter {
  readonly id: ProviderId;
  readonly capabilities: Readonly<AdapterCapabilities>;
  readonly spawns: SpawnRequest[] = [];
  readonly controls: FakeControl[] = [];
  readonly ingested: OutOfBandInput[] = [];
  readonly #options: FakeAdapterOptions;

  constructor(options: FakeAdapterOptions = {}) {
    this.#options = options;
    this.id = options.id ?? "custom";
    this.capabilities = Object.freeze({ ...DEFAULT_CAPABILITIES, ...options.capabilities });
  }

  /** The most recent control returned by `connect`. */
  get lastControl(): FakeControl | undefined {
    return this.controls.at(-1);
  }

  buildSpawn(req: SpawnRequest, ctx: RunnerContext): SpawnPlan {
    this.spawns.push(req);
    let env = SecretEnv.of({ HOME: ctx.home });
    if (req.credential.kind === "api_key") {
      env = env.with("FAKE_API_KEY", req.credential.apiKey);
    } else if (req.credential.kind === "base_url_key") {
      env = env
        .with("FAKE_BASE_URL", req.credential.baseUrl)
        .with("FAKE_API_KEY", req.credential.apiKey);
    }
    const files: PlannedFile[] = [];
    if (ctx.agentToken) {
      const body = {
        hookUrl: `${ctx.officeUrl}/hooks/${req.agentId}`,
        token: ctx.agentToken.reveal(),
      };
      files.push({
        path: `${ctx.home}/.fake-agent/${req.agentId}.json`,
        contents: Secret.of(JSON.stringify(body)),
        mode: 0o600,
      });
    }
    const argv = [...(this.#options.command ?? ["sh", "-c", "exit 0"])];
    if (req.model) argv.push("--model", req.model);
    if (req.resumeSessionId) argv.push("--resume", req.resumeSessionId);
    return {
      agentId: req.agentId,
      provider: this.id,
      argv,
      env,
      cwd: req.workdir,
      tmuxSession: tmuxSessionName(req.agentId),
      files,
      providerSessionId: req.resumeSessionId ?? this.#options.providerSessionId,
    };
  }

  connect(plan: SpawnPlan, ctx: RunnerContext): FakeControl {
    const control = new FakeControl(plan, ctx, this.#options.onPrompt, plan.providerSessionId);
    this.controls.push(control);
    for (const event of this.#options.script ?? []) control.emit(event);
    return control;
  }

  buildAttachTui(agent: AgentRecord, ctx: RunnerContext): SpawnPlan | null {
    if (!this.capabilities.attachTui) return null;
    const argv = [...(this.#options.command ?? ["sh"])];
    if (agent.providerSessionId) argv.push("--resume", agent.providerSessionId);
    return {
      agentId: agent.agentId,
      provider: this.id,
      argv,
      env: SecretEnv.of({ HOME: ctx.home }),
      cwd: agent.workdir,
      tmuxSession: agent.tmuxSession,
      files: [],
      providerSessionId: agent.providerSessionId,
    };
  }

  loginFlow(_ctx: RunnerContext): LoginFlowPlan {
    return (
      this.#options.login ?? { kind: "api_key", envVar: "FAKE_API_KEY", label: "Fake API key" }
    );
  }

  async *readUsage(
    _ctx: RunnerContext,
    opts: { since?: number } = {},
  ): AsyncIterable<UsageSample | LimitSample> {
    for (const sample of this.#options.usage ?? []) {
      const ts = "ts" in sample ? sample.ts : sample.observedAt;
      if (opts.since === undefined || ts > opts.since) yield sample;
    }
  }

  /** Accepts payloads that already are `AgentEvent`s; drops anything else. */
  ingest(input: OutOfBandInput): AgentEvent[] {
    this.ingested.push(input);
    const parsed = AgentEvent.safeParse(input.payload);
    return parsed.success ? [parsed.data] : [];
  }
}
