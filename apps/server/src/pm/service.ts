/**
 * What people do with office agents (#271): list, create, configure, start
 * and stop them, mint tokens, talk to them and answer their questions.
 *
 * Rules (protocol office-agents.ts; SPEC §8, D2, D20, D28, D32):
 * - a shared agent is created and configured by office owners and admins and
 *   always names an office-wide key; members and above talk to it (office
 *   viewers do not: it spends the office key), each within an hourly limit;
 * - a personal agent is created by the person it belongs to (up to the cap
 *   admins set); only that person configures it, talks to it and reads its
 *   conversation and instructions. An admin sees its card and may stop it in
 *   an emergency, nothing more;
 * - an owner has at most one PM, and so does the office;
 * - an agent somebody may not see answers 404, like one that does not exist.
 *
 * Every change is audited; entries never hold a token or a message's text.
 */
import {
  type CreateOfficeAgent,
  type HumanRequest,
  mayConfigureOfficeAgent,
  mayCreateOfficeAgent,
  mayEmergencyStopOfficeAgent,
  maySeeOfficeAgent,
  mayTalkToOfficeAgent,
  type OfficeAgentConversation,
  type OfficeAgentGrant,
  type OfficeAgentMessage,
  type OfficeAgentRunsOnResponse,
  type OfficeAgentSettings,
  type OfficeAgentsResponse,
  type OfficeAgentTokenCreated,
  type OfficeAgentView,
  type UpdateOfficeAgent,
} from "@regulus/protocol";
import type { z } from "zod";
import { AUDIT_ACTIONS, type AuditAction, writeAudit } from "../auth/audit.ts";
import { AuthHttpError, forbidden } from "../auth/errors.ts";
import { isOfficeManager, type OperationActor } from "../operations/access.ts";
import { grantsAsSetBy } from "./access.ts";
import type { Conversations } from "./conversations.ts";
import type { AgentCredentials } from "./engines/credentials.ts";
import { EngineRefusal } from "./engines/types.ts";
import type { HumanRequests } from "./requests.ts";
import { runsOnChoices } from "./runs-on.ts";
import type { AgentRuntime } from "./runtime.ts";
import type { OfficeAgentRow, OfficeAgentStore } from "./store.ts";
import type { OfficeAgentTokens } from "./tokens.ts";
import { agentView } from "./view.ts";

export type CreateInput = z.output<typeof CreateOfficeAgent>;
export type UpdateInput = z.output<typeof UpdateOfficeAgent>;

export interface OfficeAgentServiceDeps {
  store: OfficeAgentStore;
  tokens: OfficeAgentTokens;
  runtime: AgentRuntime;
  conversations: Conversations;
  requests: HumanRequests;
  credentials: AgentCredentials;
  now?: () => number;
}

/** The window of the per-person message limit on shared agents. */
export const MESSAGE_WINDOW_MS = 60 * 60_000;

const notFound = () => new AuthHttpError(404, "not_found");
const conflict = (code: string) => new AuthHttpError(409, code);
const refused = (err: EngineRefusal, status = 400) =>
  new AuthHttpError(status, err.code, { message: err.message });

export class OfficeAgentService {
  constructor(private readonly deps: OfficeAgentServiceDeps) {}

  // ---- Reading -----------------------------------------------------------------

  list(actor: OperationActor): OfficeAgentsResponse {
    return {
      agents: this.deps.store
        .list()
        .filter((row) => maySeeOfficeAgent(actor, row))
        .map((row) => this.view(actor, row)),
      settings: this.deps.store.settings(),
      engines: this.deps.runtime.kinds(),
    };
  }

  /** What the actor could run an agent on right now: names and kinds, never a key. */
  runsOn(actor: OperationActor): OfficeAgentRunsOnResponse {
    return runsOnChoices(this.deps.store.db, actor);
  }

  view(actor: OperationActor, row: OfficeAgentRow): OfficeAgentView {
    return agentView(this.deps, actor, row);
  }

  /** The agent, when the actor may see it at all. */
  #visible(actor: OperationActor, id: string): OfficeAgentRow {
    const row = this.deps.store.get(id);
    if (!row || !maySeeOfficeAgent(actor, row)) throw notFound();
    return row;
  }

  #configurable(actor: OperationActor, id: string): OfficeAgentRow {
    const row = this.#visible(actor, id);
    if (!mayConfigureOfficeAgent(actor, row)) {
      throw forbidden(row.ownerUserId === null ? "owner_or_admin_required" : "not_your_agent");
    }
    return row;
  }

  #talkable(actor: OperationActor, id: string): OfficeAgentRow {
    const row = this.#visible(actor, id);
    if (!mayTalkToOfficeAgent(actor, row)) {
      throw forbidden(row.ownerUserId === null ? "viewers_cannot" : "not_your_agent");
    }
    return row;
  }

  #audit(actor: OperationActor, action: AuditAction, agentId: string, meta: object = {}): void {
    writeAudit(this.deps.store.db, {
      userId: actor.id,
      action,
      targetKind: "office_agent",
      targetId: agentId,
      meta: { ...meta },
    });
  }

  /** The engine's and the credential rules' verdict on a configuration. */
  #check(
    row: Pick<OfficeAgentRow, "engine" | "ownerUserId" | "provider" | "profileId">,
    full: OfficeAgentRow,
  ) {
    const engine = this.deps.runtime.engine(row.engine);
    if (!engine) throw new AuthHttpError(400, "engine_unavailable");
    try {
      // Whatever the engine: a shared agent names an office key, a personal one what its owner may use.
      this.deps.credentials.check(row);
      engine.check(this.deps.runtime.engineAgent(full));
    } catch (err) {
      if (err instanceof EngineRefusal) throw refused(err);
      throw err;
    }
  }

  // ---- Configuration -------------------------------------------------------------

  create(actor: OperationActor, input: CreateInput): OfficeAgentView {
    const { store } = this.deps;
    if (!mayCreateOfficeAgent(actor, input.owner)) {
      throw forbidden(input.owner === "office" ? "owner_or_admin_required" : "viewers_cannot");
    }
    const ownerUserId = input.owner === "office" ? null : actor.id;
    if (store.nameTaken(input.name)) throw conflict("name_taken");
    if (ownerUserId !== null) {
      const cap = store.settings().personalAgentCap;
      if (store.countOwnedBy(ownerUserId) >= cap) {
        throw new AuthHttpError(409, "personal_agent_cap", { cap });
      }
    }
    if (input.role === "pm" && store.ownedBy(ownerUserId).some((a) => a.role === "pm")) {
      throw conflict("pm_exists");
    }
    const draft = {
      name: input.name,
      ownerUserId,
      engine: input.engine,
      role: input.role,
      preset: input.preset,
      provider: input.provider,
      model: input.model,
      effort: input.effort ?? null,
      profileId: input.profileId ?? null,
      appearance: input.appearance,
      instructions: input.instructions,
      createdBy: actor.id,
    };
    this.#check(draft, {
      ...draft,
      id: "draft",
      nameKey: "",
      status: "stopped",
      statusReason: null,
      engineState: "{}",
      lastActivityAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const row = store.insert(store.db, draft);
    this.#audit(actor, AUDIT_ACTIONS.officeAgentCreate, row.id, {
      name: row.name,
      shared: ownerUserId === null,
      engine: row.engine,
      role: row.role,
      preset: row.preset,
      provider: row.provider,
      model: row.model,
      appearance: row.appearance,
    });
    return this.view(actor, row);
  }

  async update(actor: OperationActor, id: string, patch: UpdateInput): Promise<OfficeAgentView> {
    const { store, runtime } = this.deps;
    const row = this.#configurable(actor, id);
    if (
      patch.role === "pm" &&
      row.role !== "pm" &&
      store.ownedBy(row.ownerUserId).some((a) => a.role === "pm")
    ) {
      throw conflict("pm_exists");
    }
    const next: OfficeAgentRow = {
      ...row,
      ...(patch.role !== undefined ? { role: patch.role } : {}),
      ...(patch.preset !== undefined ? { preset: patch.preset } : {}),
      ...(patch.model !== undefined ? { model: patch.model } : {}),
      ...(patch.effort !== undefined ? { effort: patch.effort } : {}),
      ...(patch.profileId !== undefined ? { profileId: patch.profileId } : {}),
      ...(patch.appearance !== undefined ? { appearance: patch.appearance } : {}),
      ...(patch.instructions !== undefined ? { instructions: patch.instructions } : {}),
    };
    this.#check(next, next);
    // The engine holds the configuration it was started with: stop it, the next message starts it anew.
    // Its looks are not part of that: changing only the appearance leaves it running.
    const looksOnly = Object.keys(patch).every((key) => key === "appearance");
    if (!looksOnly && runtime.isRunning(row.id)) {
      await runtime.stop(row.id, row.engine, "configuration changed");
    }
    const saved = store.update(row.id, {
      role: next.role,
      preset: next.preset,
      model: next.model,
      effort: next.effort,
      profileId: next.profileId,
      appearance: next.appearance,
      instructions: next.instructions,
    });
    if (!saved) throw notFound();
    this.#audit(actor, AUDIT_ACTIONS.officeAgentUpdate, row.id, {
      fields: Object.keys(patch),
      ...(patch.preset !== undefined ? { preset: patch.preset } : {}),
    });
    return this.view(actor, saved);
  }

  async remove(actor: OperationActor, id: string): Promise<void> {
    const row = this.#configurable(actor, id);
    await this.deps.runtime.stop(row.id, row.engine);
    this.deps.store.delete(row.id);
    this.#audit(actor, AUDIT_ACTIONS.officeAgentDelete, row.id, {
      name: row.name,
      shared: row.ownerUserId === null,
    });
  }

  setGrants(actor: OperationActor, id: string, grants: readonly OfficeAgentGrant[]) {
    const row = this.#configurable(actor, id);
    if (row.ownerUserId !== null) {
      // A personal agent has its owner's access, nothing can be granted on top.
      throw new AuthHttpError(400, "personal_agents_have_no_grants");
    }
    const merged = grantsAsSetBy(this.deps.store, actor, row.id, grants);
    if (!this.deps.store.setGrants(row.id, merged)) {
      throw new AuthHttpError(400, "unknown_operation");
    }
    this.#audit(actor, AUDIT_ACTIONS.officeAgentGrantsSet, row.id, { grants });
    return this.view(actor, row);
  }

  mintToken(actor: OperationActor, id: string, label: string): OfficeAgentTokenCreated {
    const row = this.#configurable(actor, id);
    const minted = this.deps.tokens.mint(row.id, "api", label);
    if (!minted) throw conflict("too_many_tokens");
    this.#audit(actor, AUDIT_ACTIONS.officeAgentTokenCreate, row.id, { tokenId: minted.id, label });
    return minted;
  }

  revokeToken(actor: OperationActor, id: string, tokenId: string): void {
    const row = this.#configurable(actor, id);
    if (!this.deps.tokens.revoke(row.id, tokenId)) throw notFound();
    this.#audit(actor, AUDIT_ACTIONS.officeAgentTokenRevoke, row.id, { tokenId });
  }

  async start(actor: OperationActor, id: string): Promise<OfficeAgentView> {
    const row = this.#configurable(actor, id);
    try {
      await this.deps.runtime.start(row);
    } catch (err) {
      if (err instanceof EngineRefusal) throw refused(err, 409);
      throw err;
    }
    this.#audit(actor, AUDIT_ACTIONS.officeAgentStart, row.id);
    return this.view(actor, this.deps.store.get(row.id) ?? row);
  }

  /** Whoever configures it stops it; an office admin may stop anyone's personal agent (audited). */
  async stop(actor: OperationActor, id: string): Promise<OfficeAgentView> {
    const row = this.#visible(actor, id);
    const emergency = mayEmergencyStopOfficeAgent(actor, row);
    if (!mayConfigureOfficeAgent(actor, row) && !emergency) throw forbidden("not_your_agent");
    await this.deps.runtime.stop(
      row.id,
      row.engine,
      emergency ? "stopped by an office admin" : undefined,
    );
    this.#audit(
      actor,
      emergency ? AUDIT_ACTIONS.officeAgentEmergencyStop : AUDIT_ACTIONS.officeAgentStop,
      row.id,
      emergency ? { ownerUserId: row.ownerUserId } : {},
    );
    return this.view(actor, this.deps.store.get(row.id) ?? row);
  }

  settings(): OfficeAgentSettings {
    return this.deps.store.settings();
  }

  saveSettings(actor: OperationActor, settings: OfficeAgentSettings): OfficeAgentSettings {
    if (!isOfficeManager(actor.role)) throw forbidden("owner_or_admin_required");
    this.deps.store.saveSettings(settings);
    writeAudit(this.deps.store.db, {
      userId: actor.id,
      action: AUDIT_ACTIONS.officeAgentSettings,
      targetKind: "office_agent",
      targetId: null,
      meta: { ...settings },
    });
    return settings;
  }

  // ---- Conversation --------------------------------------------------------------

  conversation(actor: OperationActor, id: string): OfficeAgentConversation {
    const row = this.#talkable(actor, id);
    return {
      agentId: row.id,
      messages: this.deps.conversations.recent(row.id, actor.id),
      waiting: this.deps.conversations.waiting(row.id, actor.id),
      status: row.status,
    };
  }

  async send(actor: OperationActor, id: string, text: string): Promise<OfficeAgentMessage> {
    const row = this.#talkable(actor, id);
    const person = this.deps.store.person(actor.id);
    if (!person) throw forbidden();
    this.#checkMessageRate(row, actor.id);
    try {
      return await this.deps.runtime.deliver(row, person, text);
    } catch (err) {
      if (err instanceof EngineRefusal) throw refused(err, 409);
      throw err;
    }
  }

  /**
   * A shared agent answers on the office's metered key, so each person may
   * send it only so many messages an hour (an admin setting). Personal agents
   * run on what their owner chose and are not limited here.
   */
  #checkMessageRate(row: OfficeAgentRow, userId: string): void {
    if (row.ownerUserId !== null) return;
    const limit = this.deps.store.settings().sharedMessagesPerHour;
    const now = (this.deps.now ?? Date.now)();
    const sent = this.deps.conversations.sentSince(row.id, userId, now - MESSAGE_WINDOW_MS);
    if (sent.length < limit) return;
    // Free again when the oldest message that still counts leaves the window.
    const oldest = sent[sent.length - limit] ?? now;
    const retryAfterSeconds = Math.max(1, Math.ceil((oldest + MESSAGE_WINDOW_MS - now) / 1000));
    throw new AuthHttpError(429, "message_rate_limited", { limit, retryAfterSeconds });
  }

  // ---- "Ask a human" --------------------------------------------------------------

  /** The actor's own pending questions. Nobody reads another person's. */
  pendingRequests(actor: OperationActor): HumanRequest[] {
    return this.deps.requests.pendingFor(actor.id);
  }

  async answer(actor: OperationActor, requestId: string, answer: string): Promise<HumanRequest> {
    const { requests, store, runtime } = this.deps;
    const request = requests.get(requestId);
    // Someone else's question is indistinguishable from a missing one.
    if (!request || request.forUserId !== actor.id) throw notFound();
    const answered = requests.answer(requestId, answer);
    if (!answered) throw conflict("already_answered");
    this.#audit(actor, AUDIT_ACTIONS.officeAgentRequestAnswer, request.agentId, { requestId });
    // The answer also reaches the agent as the person's next message, which opens their turn.
    const row = store.get(request.agentId);
    const person = store.person(actor.id);
    // Only for someone who may talk to it: a viewer's answer is recorded, not delivered as a message.
    if (row && person && mayTalkToOfficeAgent(actor, row)) {
      const text = `[Answer to your question "${request.question.slice(0, 200)}" (request ${request.id})]\n${answer}`;
      await runtime.deliver(row, person, text).catch(() => {});
    }
    return answered;
  }
}
