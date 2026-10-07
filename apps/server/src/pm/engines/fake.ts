/**
 * The fake engine (#271): an `OfficeAgentEngine` for tests. It records what
 * the office asked of it and answers each message with `reply` (an echo by
 * default), which may use the agent's token to call the office tools like a
 * real engine would.
 */
import type { OfficeAgentEngineKind } from "@regulus/protocol";
import {
  type EngineAgent,
  type EngineEvent,
  EngineEvents,
  type EngineHealth,
  type EngineMessage,
  type EngineOffice,
  EngineRefusal,
  type OfficeAgentEngine,
} from "./types.ts";

export interface FakeEngineOptions {
  /** The kind it registers as (tests stand it in for a real engine). */
  kind?: OfficeAgentEngineKind;
  /** The answer to a message; null = say nothing (the person keeps waiting); a throw = an `error` event. */
  reply?: (
    agent: EngineAgent,
    message: EngineMessage,
    office: EngineOffice,
  ) => string | null | Promise<string | null>;
  /** Refuse to start (for the failure path). */
  failStart?: string;
}

export class FakeEngine implements OfficeAgentEngine {
  readonly kind: OfficeAgentEngineKind;
  readonly started = new Map<string, { agent: EngineAgent; office: EngineOffice }>();
  readonly sent: Array<{ agentId: string; message: EngineMessage }> = [];
  readonly stopped: string[] = [];
  readonly #events = new EngineEvents();
  readonly #pending = new Set<Promise<void>>();

  constructor(private readonly options: FakeEngineOptions = {}) {
    this.kind = options.kind ?? "cli-session";
  }

  check(agent: EngineAgent): void {
    if (agent.model === "refused-model") {
      throw new EngineRefusal("model_not_supported", "the fake engine refuses this model");
    }
  }

  async start(agent: EngineAgent, office: EngineOffice): Promise<void> {
    if (this.options.failStart) throw new EngineRefusal("start_failed", this.options.failStart);
    this.started.set(agent.id, { agent, office });
    this.emit({ type: "status", agentId: agent.id, status: "ready" });
  }

  async stop(agentId: string): Promise<void> {
    this.stopped.push(agentId);
    this.started.delete(agentId);
  }

  async send(agentId: string, message: EngineMessage): Promise<void> {
    const run = this.started.get(agentId);
    if (!run) throw new EngineRefusal("not_started", "the agent is not started");
    this.sent.push({ agentId, message });
    this.emit({ type: "status", agentId, status: "busy" });
    const work = (async () => {
      try {
        const reply = this.options.reply
          ? await this.options.reply(run.agent, message, run.office)
          : `${run.agent.name} heard: ${message.text}`;
        if (reply !== null) {
          this.emit({ type: "message", agentId, userId: message.userId, text: reply });
        }
      } catch (err) {
        this.emit({
          type: "error",
          agentId,
          userId: message.userId,
          message: err instanceof Error ? err.message : "the fake engine failed",
        });
      }
      if (this.started.has(agentId)) this.emit({ type: "status", agentId, status: "ready" });
    })();
    this.#pending.add(work);
    void work.finally(() => this.#pending.delete(work));
  }

  async health(agentId: string): Promise<EngineHealth> {
    return this.started.has(agentId)
      ? { ok: true, detail: "running" }
      : { ok: false, detail: "not started" };
  }

  onEvent(listener: (event: EngineEvent) => void): () => void {
    return this.#events.on(listener);
  }

  /** Let a test speak as the agent, or report anything else an engine can. */
  emit(event: EngineEvent): void {
    this.#events.emit(event);
  }

  /** Resolves once every message handed over so far was answered. */
  async idle(): Promise<void> {
    while (this.#pending.size > 0) await Promise.all([...this.#pending]);
  }
}
