/**
 * `OfficeAgentEngine` (SPEC §10 M5, D3; #135, #271): what runs an office
 * agent. The office knows engines only through this interface: it starts and
 * stops an agent, hands it messages, and listens for what it says and how it
 * is doing. Everything an agent *does* in the office goes the other way,
 * through the office tools (MCP or REST) with the token it is started with.
 *
 * Implemented here by the CLI session engine (cli-session.ts) and the fake
 * engine for tests (fake.ts). The Hermes engines (#57 managed profile, #58
 * external gateway) and OpenClaw implement the same interface: a gateway
 * engine keeps its session map in `EngineAgent.state`, reports it back with a
 * `state` event, and answers `health` from its connection.
 */
import type { Secret } from "@regulus/agent-adapters";
import type {
  OfficeAgentEngineKind,
  OfficeAgentPreset,
  OfficeAgentRole,
  OfficeAgentStatus,
  ProviderId,
} from "@regulus/protocol";

/** The agent as an engine sees it. Holds no credential. */
export interface EngineAgent {
  id: string;
  name: string;
  role: OfficeAgentRole;
  preset: OfficeAgentPreset;
  /** Null: a shared agent, run by the office on an office key (D2). Else the person it belongs to. */
  ownerUserId: string | null;
  ownerName: string | null;
  provider: ProviderId;
  model: string;
  effort: string | null;
  /** Credential choice (a reference): profile id, `office:<provider>`, or null = the owner's CLI login. */
  profileId: string | null;
  /** The agent's soul as it was when it was started (#136): who it is and how it works. */
  instructions: string;
  /** What the engine reported with its last `state` event. */
  state: Record<string, unknown>;
}

/** A memory or a note as the office keeps it. */
export interface EngineMemory {
  id: string;
  kind: "memory" | "note";
  /** Notes only. */
  title?: string;
  text: string;
  source?: string;
  updatedAt: number;
}

/**
 * The agent's soul, memories and notes as an engine reaches them (#136). The
 * office's copy is the source of truth; this is one agent's own, bound when
 * it is started, and holds nobody else's.
 *
 * - An engine without a memory of its own (the CLI session engine) puts
 *   `digest()` into what the agent reads and lets the agent use the office
 *   tools (`memory_save`, `memory_search`, `note_write`, ...).
 * - An engine with its own memory (Hermes, #57 and #58) seeds it from
 *   `soul()` and `entries()` when it starts, and hands what the agent learns
 *   back with `remember()`, so the office stays complete. An engine that runs
 *   outside the office process uses the same tools over REST with the
 *   agent's token (`soul_read`, `memory_list`, `memory_save`).
 *
 * Writes go through the same checks as the tools: text that looks like a
 * secret is refused with an {@link EngineRefusal}, and each one is audited.
 */
export interface EngineMind {
  /** The soul as it is now. */
  soul(): string;
  /**
   * Every memory and note, most recently changed first. A shared agent's are
   * given for one person (#301): only those about rooms `forUserId` can see
   * themselves, and without a person only those about no room at all.
   */
  entries(kind?: "memory" | "note", forUserId?: string): EngineMemory[];
  /**
   * The newest memories and the note titles as one block of text; empty when
   * there are none. For a shared agent: of what `forUserId`, the person whose
   * message it is about to answer, may see (as `entries`).
   */
  digest(forUserId?: string): string;
  /** Store something the agent learned. Throws an {@link EngineRefusal} when it is refused. */
  remember(text: string, source?: string): EngineMemory;
  /** Remove a memory; false when it was not there. */
  forget(id: string): boolean;
}

/** How the started agent reaches the office. */
export interface EngineOffice {
  /** The office MCP endpoint (streamable HTTP), as reachable from where the engine runs. */
  mcpUrl: string;
  /** Base of the same tools as REST. */
  toolsUrl: string;
  /** The agent's token for this run; revoked when the agent stops. */
  token: Secret;
  /** The agent's own soul, memories and notes, from the office's copy (#136). */
  mind: EngineMind;
}

/** An agent that remembers nothing, for tests that start an engine by hand. */
export const EMPTY_MIND: EngineMind = {
  soul: () => "",
  entries: () => [],
  digest: () => "",
  remember: () => {
    throw new Error("no mind");
  },
  forget: () => false,
};

/** One message from a person to the agent. */
export interface EngineMessage {
  /** The stored message's id. */
  id: string;
  /** The person whose conversation this is; replies carry it back. */
  userId: string;
  fromName: string;
  text: string;
}

export interface EngineUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
}

export type EngineEvent =
  /** The agent said something to a person. */
  | { type: "message"; agentId: string; userId: string; text: string }
  /**
   * Whose message the agent is working on from now on, or null when it is
   * done with it (#301). Only an engine that runs an agent's turns one at a
   * time reports this: the office answers the agent's tool calls for that
   * person, within that person's own access.
   */
  | { type: "turn"; agentId: string; userId: string | null }
  | { type: "status"; agentId: string; status: OfficeAgentStatus; reason?: string }
  /** Engine state to keep across restarts (never a credential). */
  | { type: "state"; agentId: string; state: Record<string, unknown> }
  | {
      type: "usage";
      agentId: string;
      usage: EngineUsage;
      /** Who pays: `office` for an office key, else the person whose credential ran. */
      attributedTo: "office" | { userId: string };
      dedupeKey: string;
    }
  /** A message could not be handled; `message` is safe to show the person. */
  | { type: "error"; agentId: string; userId?: string; message: string };

export interface EngineHealth {
  ok: boolean;
  /** Short and safe to show: "running", "gateway unreachable", ... */
  detail: string;
}

/** A configuration the engine cannot run; the message is safe to show. */
export class EngineRefusal extends Error {
  override name = "EngineRefusal";
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface OfficeAgentEngine {
  readonly kind: OfficeAgentEngineKind;
  /** Throw an {@link EngineRefusal} for a configuration this engine cannot run (called before it is stored). */
  check(agent: EngineAgent): void;
  /** Bring the agent up. Throws an {@link EngineRefusal} when it cannot start. */
  start(agent: EngineAgent, office: EngineOffice): Promise<void>;
  /** Idempotent. */
  stop(agentId: string): Promise<void>;
  /** Hand over a message. Replies and failures arrive as events. */
  send(agentId: string, message: EngineMessage): Promise<void>;
  /**
   * Drop what the engine keeps of the agent's conversation with one person
   * (its session), so their next message starts with nothing of the earlier
   * ones (#301: that person lost a room the conversation had read). The
   * history people see is the office's and stays.
   */
  forgetConversation?(agentId: string, userId: string): void;
  health(agentId: string): Promise<EngineHealth>;
  /** Subscribe to the engine's events for every agent it runs. */
  onEvent(listener: (event: EngineEvent) => void): () => void;
}

/** Listener plumbing shared by the engines. */
export class EngineEvents {
  readonly #listeners = new Set<(event: EngineEvent) => void>();

  on(listener: (event: EngineEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  emit(event: EngineEvent): void {
    for (const listener of [...this.#listeners]) {
      try {
        listener(event);
      } catch {
        // A failing listener must not break the engine or the other listeners.
      }
    }
  }
}
