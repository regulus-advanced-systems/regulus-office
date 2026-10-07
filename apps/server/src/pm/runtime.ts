/**
 * Running office agents (#271): the registered engines, starting and stopping
 * an agent on its engine, handing it a person's message, and taking in what
 * the engine reports (replies, status, state, usage).
 *
 * Nothing here decides who may do what: service.ts authorises people, and
 * tools/ authorises what the agent itself does.
 */
import { Secret } from "@regulus/agent-adapters";
import {
  OFFICE_AGENT_TOOLS_API_PATH,
  OFFICE_MCP_PATH,
  type OfficeAgentEngineKind,
  type OfficeAgentMessage,
} from "@regulus/protocol";
import type { Logger } from "../logging.ts";
import type { UsageRecorder } from "../usage/index.ts";
import type { Conversations } from "./conversations.ts";
import {
  type EngineAgent,
  type EngineEvent,
  type EngineMind,
  EngineRefusal,
  type OfficeAgentEngine,
} from "./engines/types.ts";
import type { OfficeAgentRow, OfficeAgentStore } from "./store.ts";
import type { OfficeAgentTokens } from "./tokens.ts";

const STATE_MAX_BYTES = 64 * 1024;

export interface AgentRuntimeDeps {
  store: OfficeAgentStore;
  tokens: OfficeAgentTokens;
  conversations: Conversations;
  /** The agent's own soul, memories and notes, from the office's copy (#136). */
  mind: (agentId: string) => EngineMind;
  /** Base URL of the office as engines reach it (no trailing slash). */
  officeUrl: string;
  usage?: UsageRecorder;
  logger: Logger;
  now?: () => number;
}

function stateOf(json: string): Record<string, unknown> {
  try {
    const v = JSON.parse(json) as unknown;
    return v !== null && typeof v === "object" && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export class AgentRuntime {
  readonly #engines = new Map<OfficeAgentEngineKind, OfficeAgentEngine>();
  readonly #offs: Array<() => void> = [];
  /** Agents started in this process. */
  readonly #running = new Set<string>();
  readonly #starting = new Map<string, Promise<void>>();

  constructor(private readonly deps: AgentRuntimeDeps) {}

  register(engine: OfficeAgentEngine): this {
    if (this.#engines.has(engine.kind)) throw new Error(`engine ${engine.kind} registered twice`);
    this.#engines.set(engine.kind, engine);
    this.#offs.push(engine.onEvent((event) => this.#onEvent(engine.kind, event)));
    return this;
  }

  kinds(): OfficeAgentEngineKind[] {
    return [...this.#engines.keys()];
  }

  engine(kind: OfficeAgentEngineKind): OfficeAgentEngine | undefined {
    return this.#engines.get(kind);
  }

  isRunning(agentId: string): boolean {
    return this.#running.has(agentId);
  }

  engineAgent(row: OfficeAgentRow): EngineAgent {
    const owner = row.ownerUserId ? this.deps.store.person(row.ownerUserId) : undefined;
    return {
      id: row.id,
      name: row.name,
      role: row.role,
      preset: row.preset,
      ownerUserId: row.ownerUserId,
      ownerName: owner?.displayName ?? null,
      provider: row.provider,
      model: row.model,
      effort: row.effort,
      profileId: row.profileId,
      instructions: row.instructions,
      state: stateOf(row.engineState),
    };
  }

  /** After a restart: nothing runs, and no engine run holds a token. */
  boot(): void {
    this.deps.store.resetStatuses();
    this.deps.tokens.revokeAllSessions();
  }

  /** Start the agent on its engine with a fresh session token. Throws {@link EngineRefusal}. */
  start(row: OfficeAgentRow): Promise<void> {
    const pending = this.#starting.get(row.id);
    if (pending) return pending;
    const run = this.#start(row).finally(() => this.#starting.delete(row.id));
    this.#starting.set(row.id, run);
    return run;
  }

  async #start(row: OfficeAgentRow): Promise<void> {
    const engine = this.#engines.get(row.engine);
    if (!engine) {
      throw new EngineRefusal("engine_unavailable", `the ${row.engine} engine is not available`);
    }
    const { store, tokens } = this.deps;
    store.setStatus(row.id, "starting");
    tokens.revokeSessions(row.id);
    const minted = tokens.mint(row.id, "session", "engine run");
    if (!minted) throw new Error("session token not minted");
    try {
      await engine.start(this.engineAgent(row), {
        mcpUrl: `${this.deps.officeUrl}${OFFICE_MCP_PATH}`,
        toolsUrl: `${this.deps.officeUrl}${OFFICE_AGENT_TOOLS_API_PATH}`,
        token: Secret.of(minted.token),
        mind: this.deps.mind(row.id),
      });
    } catch (err) {
      tokens.revokeSessions(row.id);
      const reason = err instanceof EngineRefusal ? err.message : "the engine could not start it";
      store.setStatus(row.id, "error", reason);
      if (err instanceof EngineRefusal) throw err;
      this.deps.logger.error({ agentId: row.id, err: String(err).slice(0, 300) }, "start failed");
      throw new EngineRefusal("start_failed", reason);
    }
    this.#running.add(row.id);
    // The engine may have reported `ready` already; never go back to `starting`.
    if (store.get(row.id)?.status === "starting") store.setStatus(row.id, "ready");
  }

  async stop(agentId: string, engineKind: OfficeAgentEngineKind, reason?: string): Promise<void> {
    await this.#starting.get(agentId)?.catch(() => {});
    this.#running.delete(agentId);
    this.deps.tokens.revokeSessions(agentId);
    try {
      await this.#engines.get(engineKind)?.stop(agentId);
    } catch (err) {
      this.deps.logger.warn({ agentId, err: String(err).slice(0, 300) }, "engine stop failed");
    }
    this.deps.store.setStatus(agentId, "stopped", reason ?? null);
  }

  /**
   * Store a person's message and hand it to the agent, starting it first when
   * it is not running. The reply arrives later, as an engine event. Throws
   * {@link EngineRefusal} when the agent cannot be started or reached; the
   * message is then answered with a system line so the turn does not stay open.
   */
  async deliver(
    row: OfficeAgentRow,
    person: { id: string; displayName: string },
    text: string,
  ): Promise<OfficeAgentMessage> {
    const { conversations, store } = this.deps;
    const message = conversations.append(row.id, person.id, "person", text);
    store.touch(row.id);
    try {
      if (!this.#running.has(row.id)) await this.start(row);
      const engine = this.#engines.get(row.engine);
      if (!engine) throw new EngineRefusal("engine_unavailable", "the engine is not available");
      await engine.send(row.id, {
        id: message.id,
        userId: person.id,
        fromName: person.displayName,
        text,
      });
    } catch (err) {
      const reason = err instanceof EngineRefusal ? err.message : "the agent could not be reached";
      conversations.append(row.id, person.id, "system", `Not delivered: ${reason}`);
      if (err instanceof EngineRefusal) throw err;
      this.deps.logger.error({ agentId: row.id, err: String(err).slice(0, 300) }, "send failed");
      throw new EngineRefusal("send_failed", reason);
    }
    return message;
  }

  async close(): Promise<void> {
    for (const off of this.#offs.splice(0)) off();
    for (const id of [...this.#running]) {
      const row = this.deps.store.get(id);
      if (row) await this.stop(id, row.engine);
    }
  }

  #onEvent(kind: OfficeAgentEngineKind, event: EngineEvent): void {
    const { store, conversations, logger } = this.deps;
    const row = store.get(event.agentId);
    // An engine speaks only for agents that are its own.
    if (!row || row.engine !== kind) return;
    try {
      switch (event.type) {
        case "message": {
          if (!this.#mayAddress(row, event.userId)) return;
          conversations.append(row.id, event.userId, "agent", event.text);
          store.touch(row.id);
          return;
        }
        case "error": {
          if (event.userId && this.#mayAddress(row, event.userId)) {
            conversations.append(row.id, event.userId, "system", event.message);
          }
          return;
        }
        case "status": {
          // A stopped agent stays stopped whatever a late event says.
          if (!this.#running.has(row.id) && !this.#starting.has(row.id)) return;
          store.setStatus(row.id, event.status, event.reason ?? null);
          return;
        }
        case "state": {
          const json = JSON.stringify(event.state);
          if (json.length <= STATE_MAX_BYTES) store.update(row.id, { engineState: json });
          return;
        }
        case "usage": {
          // A shared agent's usage is always the office's (D2), whatever the engine says.
          const attributedTo = row.ownerUserId === null ? "office" : event.attributedTo;
          if (attributedTo !== "office" && attributedTo.userId !== row.ownerUserId) return;
          this.deps.usage?.recordUsage({
            attributedTo,
            provider: row.provider,
            model: row.model,
            sample: {
              ts: (this.deps.now ?? Date.now)(),
              inputTokens: event.usage.inputTokens,
              outputTokens: event.usage.outputTokens,
              cacheReadTokens: event.usage.cacheReadTokens,
              cacheWriteTokens: event.usage.cacheWriteTokens,
              ...(event.usage.costUsd > 0 ? { costUsdEstimate: event.usage.costUsd } : {}),
              source: "inband",
              dedupeKey: event.dedupeKey,
            },
          });
          return;
        }
      }
    } catch (err) {
      logger.error({ agentId: row.id, err: String(err).slice(0, 300) }, "engine event failed");
    }
  }

  /** A personal agent speaks only to its owner; a shared one to people who exist. */
  #mayAddress(row: OfficeAgentRow, userId: string): boolean {
    if (row.ownerUserId !== null) return row.ownerUserId === userId;
    return this.deps.store.person(userId) !== undefined;
  }
}
