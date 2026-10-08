/**
 * The `hermes-external` engine (SPEC §10 M5, D3, D28; #58): an office agent
 * that is a person's own Hermes Agent, already running somewhere else. The
 * office connects to its gateway's API server and is one more channel to the
 * same agent, next to Telegram and the others, which keep working.
 *
 * - `start` reads the owner's connection, checks that a Hermes answers and
 *   takes the token, and from then on probes it: a gateway that goes away
 *   shows on the agent's card and is retried with a growing pause.
 * - `send` runs one turn in the conversation's Hermes session and streams it
 *   back. Each person's conversation has its own session, created on first
 *   use and kept in the engine state, so a restart continues it. When the
 *   owner named a session to continue, that one is used instead.
 * - A message is never dropped silently: it is retried only while Hermes
 *   has provably not taken it, and every other failure is told to the person.
 *
 * The agent uses office tools the other way round: the owner gives their
 * Hermes the office MCP address and one of the agent's access codes. The
 * token the office mints for an engine run is not used here, because the
 * office cannot write into a Hermes configuration it does not manage.
 *
 * Usage is not reported: Hermes pays for its own model, outside the office.
 */
import type { OfficeAgentEngineKind } from "@regulus/protocol";
import type { Logger } from "../../logging.ts";
import {
  type EngineAgent,
  type EngineEvent,
  EngineEvents,
  type EngineHealth,
  type EngineMessage,
  type EngineMind,
  type EngineOffice,
  EngineRefusal,
  type OfficeAgentEngine,
} from "../engines/types.ts";
import { HermesClient, type HermesClientOptions, HermesError } from "./client.ts";
import type { HermesConnection, HermesConnections } from "./connections.ts";
import { officeSystemMessage, readSessionState, type SessionState } from "./session-state.ts";
import { type HermesTurnUsage, runTurn, type TurnHost } from "./turn.ts";

export interface HermesEngineOptions {
  connections: Pick<HermesConnections, "resolve">;
  logger: Logger;
  client?: HermesClientOptions;
  /** Between health probes while all is well. */
  healthIntervalMs?: number;
  /** First pause after a failure; doubles up to `backoffMaxMs`. */
  backoffBaseMs?: number;
  backoffMaxMs?: number;
  /** How often a message Hermes has not taken yet is offered before giving up. */
  sendAttempts?: number;
  /** The engine this conversation runs for; the managed engine (#57) reuses it as its own kind. */
  kind?: OfficeAgentEngineKind;
  /** True: a shared agent may run on it (a Hermes the office runs itself, #57). */
  shared?: boolean;
  /** Told what a finished turn used, when Hermes says so (#57: a managed Hermes runs on office keys). */
  onUsage?: (agent: EngineAgent, usage: HermesTurnUsage, runId: string) => void;
}

interface Run {
  agent: EngineAgent;
  /** The office's copy of who the agent is (#136); read anew for every turn. */
  mind: Pick<EngineMind, "soul">;
  client: HermesClient;
  connection: HermesConnection;
  state: SessionState;
  health: EngineHealth;
  abort: AbortController;
  /** Turns run one after another. */
  queue: Promise<void>;
  turns: number;
  failures: number;
  timer?: ReturnType<typeof setTimeout>;
}

/** What a failure means for the person, in one sentence. */
export function describeHermesFailure(err: unknown): { code: string; message: string } {
  if (!(err instanceof HermesError)) {
    return { code: "hermes_failed", message: "talking to Hermes failed unexpectedly" };
  }
  switch (err.kind) {
    case "unreachable":
      return {
        code: "hermes_unreachable",
        message:
          "the Hermes gateway cannot be reached: check that it is running and that the office can reach its address",
      };
    case "auth":
      return {
        code: "hermes_bad_token",
        message:
          "the Hermes gateway refused the access token: enter the current one in this agent's connection",
      };
    case "not_hermes":
      return { code: "hermes_not_hermes", message: err.message };
    case "too_old":
      return { code: "hermes_too_old", message: err.message };
    default:
      return { code: `hermes_${err.kind}`, message: err.message };
  }
}

export class HermesExternalEngine implements OfficeAgentEngine {
  readonly kind: OfficeAgentEngineKind;
  readonly #events = new EngineEvents();
  readonly #runs = new Map<string, Run>();
  readonly #healthIntervalMs: number;
  readonly #backoffBaseMs: number;
  readonly #backoffMaxMs: number;
  readonly #sendAttempts: number;

  constructor(private readonly options: HermesEngineOptions) {
    this.kind = options.kind ?? "hermes-external";
    this.#healthIntervalMs = options.healthIntervalMs ?? 30_000;
    this.#backoffBaseMs = options.backoffBaseMs ?? 1_000;
    this.#backoffMaxMs = options.backoffMaxMs ?? 60_000;
    this.#sendAttempts = Math.max(1, options.sendAttempts ?? 4);
  }

  check(agent: EngineAgent): void {
    if (agent.ownerUserId === null && !this.options.shared) {
      throw new EngineRefusal(
        "personal_only",
        "an existing Hermes belongs to one person: it can only be a personal agent",
      );
    }
  }

  async start(agent: EngineAgent, office: EngineOffice): Promise<void> {
    this.check(agent);
    await this.stop(agent.id);
    const connection = this.options.connections.resolve(agent);
    const client = new HermesClient(connection, this.options.client);
    const abort = new AbortController();
    let version: string | undefined;
    try {
      ({ version } = await client.probe(abort.signal));
    } catch (err) {
      const failure = describeHermesFailure(err);
      this.options.logger.warn({ agentId: agent.id, code: failure.code }, "hermes start failed");
      throw new EngineRefusal(failure.code, failure.message);
    }
    const run: Run = {
      agent,
      mind: office.mind,
      client,
      connection,
      state: readSessionState(agent.state, connection.sessionId),
      health: { ok: true, detail: version ? `connected to Hermes ${version}` : "connected" },
      abort,
      queue: Promise.resolve(),
      turns: 0,
      failures: 0,
    };
    this.#runs.set(agent.id, run);
    this.#emit({ type: "status", agentId: agent.id, status: "ready" });
    this.#schedule(run, this.#healthIntervalMs);
  }

  async stop(agentId: string): Promise<void> {
    const run = this.#runs.get(agentId);
    if (!run) return;
    this.#runs.delete(agentId);
    clearTimeout(run.timer);
    run.abort.abort();
    // The turns in flight tell their people that they were stopped.
    await run.queue.catch(() => {});
  }

  async send(agentId: string, message: EngineMessage): Promise<void> {
    const run = this.#runs.get(agentId);
    if (!run) throw new EngineRefusal("not_started", "the agent is not started");
    run.turns += 1;
    const host = this.#host(run);
    run.queue = run.queue
      .then(() => runTurn(host, message))
      .catch((err) => {
        // runTurn reports its own failures; this is a bug in it, still not silent.
        this.options.logger.error(
          { agentId, err: err instanceof Error ? err.name : "unknown" },
          "hermes turn crashed",
        );
        this.#emit({
          type: "error",
          agentId,
          userId: message.userId,
          message: "Not delivered: talking to Hermes failed unexpectedly.",
        });
      })
      .finally(() => {
        run.turns -= 1;
        if (run.turns === 0 && this.#runs.get(agentId) === run && run.health.ok) {
          this.#emit({ type: "status", agentId, status: "ready" });
        }
      });
  }

  async health(agentId: string): Promise<EngineHealth> {
    return this.#runs.get(agentId)?.health ?? { ok: false, detail: "not started" };
  }

  onEvent(listener: (event: EngineEvent) => void): () => void {
    return this.#events.on(listener);
  }

  /** Probe now instead of at the next interval (#57: the office has just restarted the gateway). */
  async recheck(agentId: string): Promise<EngineHealth> {
    const run = this.#runs.get(agentId);
    if (!run) return { ok: false, detail: "not started" };
    await this.#probe(run);
    return run.health;
  }

  /** Resolves once every message handed over so far was dealt with (tests). */
  async idle(): Promise<void> {
    for (;;) {
      const queues = [...this.#runs.values()].map((run) => run.queue);
      await Promise.all(queues);
      if ([...this.#runs.values()].every((run) => run.turns === 0)) return;
    }
  }

  #emit(event: EngineEvent): void {
    this.#events.emit(event);
  }

  #host(run: Run): TurnHost {
    const agentId = run.agent.id;
    return {
      agentId,
      client: run.client,
      state: run.state,
      signal: run.abort.signal,
      attempts: this.#sendAttempts,
      pauseMs: (attempt) => this.#backoff(attempt),
      systemMessage: (message) => officeSystemMessage(run.agent, message, run.mind.soul()),
      sessionTitle: `Regulus Office: ${run.agent.name}`,
      emit: (event) => this.#emit(event),
      saveState: () => this.#emit({ type: "state", agentId, state: { ...run.state } }),
      usage: (usage, runId) => this.options.onUsage?.(run.agent, usage, runId),
      reachable: (ok, detail) => this.#setHealth(run, ok, detail),
    };
  }

  #backoff(failures: number): number {
    return Math.min(this.#backoffMaxMs, this.#backoffBaseMs * 2 ** Math.max(0, failures - 1));
  }

  #schedule(run: Run, delayMs: number): void {
    clearTimeout(run.timer);
    run.timer = setTimeout(() => void this.#probe(run), delayMs);
    // A probe never keeps the process alive.
    (run.timer as { unref?: () => void }).unref?.();
  }

  /** The reconnect loop: probe, and after a failure probe again with a growing pause. */
  async #probe(run: Run): Promise<void> {
    if (this.#runs.get(run.agent.id) !== run) return;
    // A turn in flight is its own proof of life (or of the opposite).
    if (run.turns > 0) return this.#schedule(run, this.#healthIntervalMs);
    try {
      const { version } = await run.client.probe(run.abort.signal);
      if (this.#runs.get(run.agent.id) !== run) return;
      this.#setHealth(run, true, version ? `connected to Hermes ${version}` : "connected");
    } catch (err) {
      if (this.#runs.get(run.agent.id) !== run) return;
      this.#setHealth(run, false, describeHermesFailure(err).message);
    }
    this.#schedule(run, run.health.ok ? this.#healthIntervalMs : this.#backoff(run.failures));
  }

  /** Record what the last contact showed, and say so on the agent's card when it changed. */
  #setHealth(run: Run, ok: boolean, detail: string): void {
    const was = run.health.ok;
    run.health = { ok, detail };
    run.failures = ok ? 0 : run.failures + 1;
    if (this.#runs.get(run.agent.id) !== run) return;
    const agentId = run.agent.id;
    if (!ok) {
      if (was) this.options.logger.warn({ agentId }, "hermes gateway lost");
      const reason = `${detail.charAt(0).toUpperCase()}${detail.slice(1)}. Trying again.`;
      this.#emit({ type: "status", agentId, status: "error", reason });
      // Find out when it is back without waiting for the next slow probe.
      this.#schedule(run, this.#backoff(run.failures));
    } else if (!was) {
      this.options.logger.info({ agentId }, "hermes gateway back");
      this.#emit({ type: "status", agentId, status: run.turns > 0 ? "busy" : "ready" });
    }
  }
}
