/**
 * What people do with a `hermes-external` agent's connection (#58): create
 * the agent with it, replace it, and try it.
 *
 * The connection is a credential of the person the agent belongs to
 * (SPEC §8, D20): only that person sets, replaces or tries it. An office
 * admin sees the agent's card and may stop it, and cannot use or read its
 * connection; to anyone else the agent does not exist. Nothing here returns
 * the address or the token, and audit entries hold neither.
 */

import { Secret } from "@regulus/agent-adapters";
import {
  type HermesConnectionInput,
  type HermesConnectionTest,
  type HermesConnectionTestResult,
  mayConfigureOfficeAgent,
  type OfficeAgentView,
  OWN_MODEL_PLACEHOLDER,
} from "@regulus/protocol";
import { AUDIT_ACTIONS, writeAudit } from "../../auth/audit.ts";
import { AuthHttpError, forbidden } from "../../auth/errors.ts";
import type { OperationActor } from "../../operations/access.ts";
import { EngineRefusal } from "../engines/types.ts";
import { seesAgent } from "../kiosk/placements.ts";
import type { AgentRuntime } from "../runtime.ts";
import type { CreateInput, OfficeAgentService } from "../service.ts";
import type { OfficeAgentRow, OfficeAgentStore } from "../store.ts";
import { HermesClient, type HermesClientOptions, HermesError } from "./client.ts";
import type { HermesConnection, HermesConnections } from "./connections.ts";

export interface HermesAgentServiceDeps {
  store: OfficeAgentStore;
  service: OfficeAgentService;
  runtime: AgentRuntime;
  connections: HermesConnections;
  client?: HermesClientOptions;
  now?: () => number;
}

/** Tries of a not yet stored connection one person may make per minute. */
export const HERMES_TESTS_PER_MINUTE = 12;

const refused = (err: EngineRefusal, status = 400) =>
  new AuthHttpError(status, err.code, { message: err.message });

const TEST_DETAIL = {
  unreachable:
    "Nothing answers at that address from where the office runs. Check that the Hermes gateway is running with its API server turned on, and that the office's server can reach it.",
  bad_token:
    "A Hermes answers there, but it refuses this access token. The token is that Hermes's API_SERVER_KEY.",
  not_hermes: "Something answers at that address, but it is not a Hermes gateway's API server.",
  too_old:
    "A Hermes answers there, but it is too old for the office: it has no session chat. Update Hermes and try again.",
} as const;

export class HermesAgentService {
  readonly #tests = new Map<string, number[]>();

  constructor(private readonly deps: HermesAgentServiceDeps) {}

  /** Create a personal agent that is the caller's own Hermes, with its connection. */
  create(actor: OperationActor, input: CreateInput): OfficeAgentView {
    const { store, service, connections } = this.deps;
    if (input.owner !== "me") {
      throw new AuthHttpError(400, "personal_only", {
        message: "an existing Hermes belongs to one person: it can only be a personal agent",
      });
    }
    if (!input.hermes) throw new AuthHttpError(400, "hermes_connection_required");
    if (!connections.usable) throw new AuthHttpError(409, "master_key_missing");
    // Hermes brings its own provider and model: the office stores neither a choice nor a key for it.
    const { hermes, profileId: _profile, effort: _effort, ...rest } = input;
    const view = service.create(actor, {
      ...rest,
      provider: "custom",
      model: OWN_MODEL_PLACEHOLDER,
    });
    try {
      connections.save({ id: view.id, ownerUserId: actor.id }, hermes);
    } catch (err) {
      store.delete(view.id);
      if (err instanceof EngineRefusal) throw refused(err, 409);
      throw err;
    }
    this.#audit(actor, view.id, hermes);
    const row = store.get(view.id);
    return row ? service.view(actor, row) : view;
  }

  /** Replace the connection. A running agent is stopped; the next message connects anew. */
  async setConnection(
    actor: OperationActor,
    agentId: string,
    input: HermesConnectionInput,
  ): Promise<OfficeAgentView> {
    const { service, runtime, connections } = this.deps;
    const row = this.#own(actor, agentId);
    if (runtime.isRunning(row.id)) await runtime.stop(row.id, row.engine, "connection changed");
    try {
      connections.save(row, input);
    } catch (err) {
      if (err instanceof EngineRefusal) throw refused(err, 409);
      throw err;
    }
    this.#audit(actor, row.id, input);
    return service.view(actor, this.deps.store.get(row.id) ?? row);
  }

  /** Try an address and token before storing them, or the agent's stored connection. */
  async test(
    actor: OperationActor,
    input: HermesConnectionTest,
  ): Promise<HermesConnectionTestResult> {
    let connection: HermesConnection;
    if ("agentId" in input) {
      try {
        connection = this.deps.connections.resolve(this.#own(actor, input.agentId));
      } catch (err) {
        if (err instanceof EngineRefusal) throw refused(err, 409);
        throw err;
      }
    } else {
      // Whoever may create a personal agent; not more often than a person types.
      if (actor.role === "viewer") throw forbidden("viewers_cannot");
      this.#limit(actor.id);
      connection = { url: input.url.replace(/\/+$/, ""), token: Secret.of(input.token) };
    }
    try {
      const { version } = await new HermesClient(connection, this.deps.client).probe();
      return {
        ok: true,
        code: "connected",
        detail: version ? `Connected to Hermes ${version}.` : "Connected to Hermes.",
        ...(version ? { version } : {}),
      };
    } catch (err) {
      const kind = err instanceof HermesError ? err.kind : "unreachable";
      const code =
        kind === "auth"
          ? "bad_token"
          : kind === "not_hermes" || kind === "too_old"
            ? kind
            : kind === "unreachable"
              ? "unreachable"
              : "not_hermes";
      return { ok: false, code, detail: TEST_DETAIL[code] };
    }
  }

  /** The caller's own `hermes-external` agent; 404 when they may not see it, 403 when it is not theirs. */
  #own(actor: OperationActor, agentId: string): OfficeAgentRow {
    const row = this.deps.store.get(agentId);
    // A board helper of a room the caller cannot see is like an agent that does not exist (#56).
    if (!row || !seesAgent(this.deps.store.db, actor, row)) {
      throw new AuthHttpError(404, "not_found");
    }
    if (row.ownerUserId === null || !mayConfigureOfficeAgent(actor, row)) {
      throw forbidden("not_your_agent");
    }
    if (row.engine !== "hermes-external") throw new AuthHttpError(400, "not_a_hermes_agent");
    return row;
  }

  #limit(userId: string): void {
    const now = (this.deps.now ?? Date.now)();
    const recent = (this.#tests.get(userId) ?? []).filter((ts) => ts > now - 60_000);
    if (recent.length >= HERMES_TESTS_PER_MINUTE) {
      throw new AuthHttpError(429, "too_many_tests", { retryAfterSeconds: 60 });
    }
    recent.push(now);
    this.#tests.set(userId, recent);
  }

  /** That the connection changed and whether it continues a session; never what it holds. */
  #audit(actor: OperationActor, agentId: string, input: HermesConnectionInput): void {
    writeAudit(this.deps.store.db, {
      userId: actor.id,
      action: AUDIT_ACTIONS.officeAgentConnectionSet,
      targetKind: "office_agent",
      targetId: agentId,
      meta: { engine: "hermes-external", continuesSession: input.sessionId !== undefined },
    });
  }
}
