/**
 * The `hermes-managed` engine (SPEC §10 M5, D2, D3, D18; #57): an office
 * agent that is a Hermes Agent the office runs itself. To the person it is
 * the same conversation as with a Hermes of their own (#58); the difference
 * is who starts, configures and stops the Hermes process.
 *
 * - `start` resolves the model key the agent may use (a shared agent: an
 *   office key only; a personal one: a key its owner picked, never a
 *   subscription login), makes up the gateway's API key, writes Hermes's
 *   configuration with the agent's own office token in it (config.ts), has
 *   the host start the gateway in the agent's own sandbox (host.ts), and
 *   waits until it answers `/health`.
 * - From then on the conversation is the external engine's, unchanged: the
 *   same client, turns and sessions (../engine.ts), pointed at the gateway
 *   the office started.
 * - The process is the office's to look after: one that ends by itself, or
 *   stops answering, shows as Error on the agent's card with the reason and
 *   is started again with a pause that doubles up to a minute. Its home is
 *   kept, so Hermes continues its sessions.
 *
 * Keys live in this process's memory and in the gateway's environment, never
 * in a log line, an event or the engine state. What the gateway printed last
 * is shown as the reason of a crash only after every key was cut out of it.
 */
import { randomBytes } from "node:crypto";
import { Secret } from "@regulus/agent-adapters";
import type { OfficeAgentEngineKind } from "@regulus/protocol";
import type { Logger } from "../../../logging.ts";
import type { AgentCredential, AgentCredentials } from "../../engines/credentials.ts";
import {
  type EngineAgent,
  type EngineEvent,
  EngineEvents,
  type EngineHealth,
  type EngineMessage,
  type EngineOffice,
  EngineRefusal,
  type OfficeAgentEngine,
} from "../../engines/types.ts";
import { HermesClient, type HermesClientOptions } from "../client.ts";
import type { HermesConnection } from "../connections.ts";
import { type HermesEngineOptions, HermesExternalEngine } from "../engine.ts";
import { type HermesKeyKind, hermesSetup, keyKindProblem } from "./config.ts";
import {
  HERMES_ENV,
  type HermesExit,
  HermesHostError,
  type HermesLaunch,
  type HermesProcess,
  type ManagedHermesHost,
} from "./host.ts";
import { describeExit, redact } from "./redact.ts";

export interface HermesManagedOptions
  extends Pick<
    HermesEngineOptions,
    "healthIntervalMs" | "backoffBaseMs" | "backoffMaxMs" | "sendAttempts"
  > {
  host: ManagedHermesHost;
  credentials: Pick<AgentCredentials, "resolve">;
  /** Which kind of key the agent's choice is (runs-on.ts), without reading the key. */
  keyKind: (agent: EngineAgent) => HermesKeyKind;
  logger: Logger;
  client?: HermesClientOptions;
  /** How long a started gateway may take to answer `/health`. */
  startTimeoutMs?: number;
  startPollMs?: number;
  /** A gateway that ran this long before it ended is restarted without the grown pause. */
  stableMs?: number;
}

interface Instance {
  agent: EngineAgent;
  office: EngineOffice;
  /** Made up by the office for this run; the gateway's `API_SERVER_KEY`. */
  key: Secret;
  /** Where the conversation finds the gateway; the address follows every restart. */
  connection: HermesConnection;
  launch: HermesLaunch;
  /** Every secret the gateway was handed, to cut out of what it prints. */
  secrets: readonly string[];
  attributedTo: AgentCredential["attributedTo"];
  process?: HermesProcess;
  /** The gateway is not running: the office is about to start it again. */
  down: boolean;
  restarts: number;
  launchedAt: number;
  timer?: ReturnType<typeof setTimeout>;
  closed: boolean;
}

export class HermesManagedEngine implements OfficeAgentEngine {
  readonly kind: OfficeAgentEngineKind = "hermes-managed";
  readonly #events = new EngineEvents();
  readonly #instances = new Map<string, Instance>();
  readonly #conversation: HermesExternalEngine;
  readonly #startTimeoutMs: number;
  readonly #startPollMs: number;
  readonly #stableMs: number;
  readonly #backoffBaseMs: number;
  readonly #backoffMaxMs: number;

  constructor(private readonly options: HermesManagedOptions) {
    this.#startTimeoutMs = options.startTimeoutMs ?? 90_000;
    this.#startPollMs = options.startPollMs ?? 500;
    this.#stableMs = options.stableMs ?? 5 * 60_000;
    this.#backoffBaseMs = options.backoffBaseMs ?? 1_000;
    this.#backoffMaxMs = options.backoffMaxMs ?? 60_000;
    this.#conversation = new HermesExternalEngine({
      kind: this.kind,
      shared: true,
      logger: options.logger,
      client: options.client,
      healthIntervalMs: options.healthIntervalMs,
      backoffBaseMs: options.backoffBaseMs,
      backoffMaxMs: options.backoffMaxMs,
      sendAttempts: options.sendAttempts,
      connections: { resolve: (agent) => this.#connection(agent.id) },
      onUsage: (agent, usage, runId) => {
        const instance = this.#instances.get(agent.id);
        if (!instance) return;
        this.#events.emit({
          type: "usage",
          agentId: agent.id,
          usage: { ...usage, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0 },
          attributedTo: instance.attributedTo,
          dedupeKey: `hermes:${agent.id}:${runId}`,
        });
      },
    });
    this.#conversation.onEvent((event) => this.#fromConversation(event));
  }

  check(agent: EngineAgent): void {
    if (agent.profileId === null) {
      throw new EngineRefusal(
        "hermes_key_required",
        "a Hermes run by the office needs an API key to run on: a subscription login cannot be used for it",
      );
    }
    const problem = keyKindProblem(this.options.keyKind(agent));
    if (problem) throw new EngineRefusal("hermes_key_unsupported", problem);
  }

  async start(agent: EngineAgent, office: EngineOffice): Promise<void> {
    this.check(agent);
    await this.stop(agent.id);
    // A shared agent gets an office key or nothing (D2); the rule is credentials.ts's.
    const resolved = this.options.credentials.resolve(agent);
    const key = Secret.of(randomBytes(32).toString("hex"));
    const setup = hermesSetup({
      agent,
      credential: resolved.credential,
      keyKind: this.options.keyKind(agent),
      office,
    });
    const instance: Instance = {
      agent,
      office,
      key,
      connection: { url: "", token: key },
      launch: {
        agentId: agent.id,
        env: { ...setup.env, [HERMES_ENV.enabled]: "true", [HERMES_ENV.key]: key.reveal() },
        files: setup.files,
      },
      secrets: [...setup.secrets, key.reveal()],
      attributedTo: resolved.attributedTo,
      down: true,
      restarts: 0,
      launchedAt: 0,
      closed: false,
    };
    this.#instances.set(agent.id, instance);
    try {
      await this.#launch(instance);
      instance.down = false;
      await this.#conversation.start(agent, office);
    } catch (err) {
      await this.stop(agent.id);
      if (err instanceof EngineRefusal) throw err;
      this.options.logger.error(
        { agentId: agent.id, err: err instanceof Error ? err.name : "unknown" },
        "managed hermes start failed",
      );
      throw new EngineRefusal("hermes_start_failed", "the office could not start Hermes");
    }
  }

  async stop(agentId: string): Promise<void> {
    const instance = this.#instances.get(agentId);
    if (!instance) return;
    instance.closed = true;
    clearTimeout(instance.timer);
    this.#instances.delete(agentId);
    await this.#conversation.stop(agentId);
    await this.#end(instance);
  }

  send(agentId: string, message: EngineMessage): Promise<void> {
    return this.#conversation.send(agentId, message);
  }

  async health(agentId: string): Promise<EngineHealth> {
    const instance = this.#instances.get(agentId);
    if (!instance) return { ok: false, detail: "not started" };
    if (instance.down) return { ok: false, detail: "Hermes is being started again" };
    return this.#conversation.health(agentId);
  }

  onEvent(listener: (event: EngineEvent) => void): () => void {
    return this.#events.on(listener);
  }

  /** The agent was removed: its Hermes and everything Hermes kept go with it. */
  async forget(agentId: string): Promise<void> {
    await this.stop(agentId);
    await this.options.host.forget(agentId);
  }

  /** After an office restart no gateway from before is watched by anyone: stop them. */
  async reap(): Promise<void> {
    try {
      await this.options.host.reap();
    } catch (err) {
      this.options.logger.warn(
        { err: err instanceof Error ? err.name : "unknown" },
        "could not stop Hermes gateways left from before",
      );
    }
  }

  /** Resolves once every message handed over so far was dealt with (tests). */
  idle(): Promise<void> {
    return this.#conversation.idle();
  }

  #connection(agentId: string) {
    const instance = this.#instances.get(agentId);
    if (!instance?.process) {
      throw new EngineRefusal("hermes_not_running", "Hermes is not running");
    }
    return instance.connection;
  }

  /** Start the gateway and wait until it answers. Throws an {@link EngineRefusal} with the reason. */
  async #launch(instance: Instance): Promise<void> {
    let process: HermesProcess;
    try {
      process = await this.options.host.launch(instance.launch);
    } catch (err) {
      if (err instanceof HermesHostError)
        throw new EngineRefusal("hermes_unavailable", err.message);
      throw err;
    }
    if (instance.closed) {
      await process.stop().catch(() => {});
      throw new EngineRefusal("stopped", "the agent was stopped while Hermes was starting");
    }
    instance.process = process;
    instance.connection.url = process.url;
    instance.launchedAt = Date.now();
    const ended = process.exited.then((exit) => ({ exit }));
    const client = new HermesClient({ url: process.url, token: instance.key }, this.options.client);
    const deadline = Date.now() + this.#startTimeoutMs;
    for (;;) {
      try {
        await client.probe();
        break;
      } catch {
        // Not there yet, or never: the loop finds out which.
      }
      const tick = await Promise.race([ended, Bun.sleep(this.#startPollMs).then(() => null)]);
      if (instance.closed) {
        await process.stop().catch(() => {});
        throw new EngineRefusal("stopped", "the agent was stopped while Hermes was starting");
      }
      if (tick) {
        await this.#end(instance);
        throw new EngineRefusal(
          "hermes_did_not_start",
          `Hermes did not start (${describeExit(tick.exit, instance.secrets)})`,
        );
      }
      if (Date.now() >= deadline) {
        await this.#end(instance);
        throw new EngineRefusal(
          "hermes_did_not_start",
          `Hermes did not answer within ${Math.round(this.#startTimeoutMs / 1000)} seconds of being started`,
        );
      }
    }
    void process.exited.then((exit) => this.#lost(instance, process, exit));
  }

  async #end(instance: Instance): Promise<void> {
    const process = instance.process;
    instance.process = undefined;
    try {
      await process?.stop();
    } catch (err) {
      this.options.logger.warn(
        { agentId: instance.agent.id, err: err instanceof Error ? err.name : "unknown" },
        "stopping a Hermes gateway failed",
      );
    }
  }

  /** The gateway ended or stopped answering: say so, and start it again after a pause. */
  #lost(instance: Instance, process: HermesProcess, exit: HermesExit | null): void {
    if (instance.closed || instance.process !== process) return;
    const agentId = instance.agent.id;
    if (Date.now() - instance.launchedAt >= this.#stableMs) instance.restarts = 0;
    instance.down = true;
    void this.#end(instance);
    const detail = exit ? describeExit(exit, instance.secrets) : "it stopped answering";
    this.options.logger.warn({ agentId, restarts: instance.restarts }, "managed hermes lost");
    this.#again(instance, `Hermes stopped unexpectedly (${detail}). Starting it again.`);
  }

  #again(instance: Instance, reason: string): void {
    const agentId = instance.agent.id;
    instance.restarts += 1;
    this.#events.emit({
      type: "status",
      agentId,
      status: "error",
      reason: redact(reason, instance.secrets),
    });
    const pause = Math.min(
      this.#backoffMaxMs,
      this.#backoffBaseMs * 2 ** Math.max(0, instance.restarts - 1),
    );
    clearTimeout(instance.timer);
    instance.timer = setTimeout(() => void this.#restart(instance), pause);
    (instance.timer as { unref?: () => void }).unref?.();
  }

  async #restart(instance: Instance): Promise<void> {
    if (instance.closed) return;
    const agentId = instance.agent.id;
    try {
      await this.#launch(instance);
    } catch (err) {
      if (instance.closed) return;
      const why = err instanceof EngineRefusal ? err.message : "the office could not start Hermes";
      this.options.logger.warn(
        { agentId, restarts: instance.restarts },
        "managed hermes restart failed",
      );
      return this.#again(instance, `${why.charAt(0).toUpperCase()}${why.slice(1)}. Trying again.`);
    }
    if (instance.closed) return;
    instance.down = false;
    this.options.logger.info({ agentId }, "managed hermes back");
    const health = await this.#conversation.recheck(agentId);
    // The conversation says so itself when it had noticed; when it had not, this does.
    if (health.ok && !instance.closed && !instance.down) {
      this.#events.emit({ type: "status", agentId, status: "ready" });
    }
  }

  #fromConversation(event: EngineEvent): void {
    const instance = this.#instances.get(event.agentId);
    if (!instance) return this.#events.emit(event);
    if (event.type === "status" && event.status === "error") {
      // Already told, with the real reason, while the office restarts the gateway.
      if (instance.down) return;
      // The process is there and does not answer: that is the office's to fix, too.
      const process = instance.process;
      if (process) {
        // When it has just ended, how it ended is the better reason: give that a moment to arrive.
        void Promise.race([process.exited, Bun.sleep(250).then(() => null)]).then((exit) =>
          this.#lost(instance, process, exit),
        );
        return;
      }
    }
    if (event.type === "status" && event.status === "ready" && instance.down) return;
    this.#events.emit(event);
  }
}
