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
 *   conversation, soul, memories and notes (D20, #136). An admin sees its card
 *   and may stop it in an emergency or remove it, and reads nothing of it;
 * - an owner has at most one PM, and so does the office;
 * - a board helper (#56) is a shared agent placed at one board of one room by
 *   an office owner or admin who can see that room; it exists only for people
 *   who see the room, and its job and its room never change (kiosk/placements.ts);
 * - an agent somebody may not see answers 404, like one that does not exist.
 *
 * Every change is audited; entries never hold a token or a message's text.
 */
import {
  type CreateOfficeAgent,
  defaultOfficeAgentAppearance,
  type HumanRequest,
  mayConfigureOfficeAgent,
  mayCreateOfficeAgent,
  mayEmergencyStopOfficeAgent,
  mayRemoveOfficeAgent,
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
import { checkAgentConfig, refused } from "./config-check.ts";
import type { Conversations } from "./conversations.ts";
import type { AgentCredentials } from "./engines/credentials.ts";
import { EngineRefusal } from "./engines/types.ts";
import { answerRequest, pendingRequestsFor } from "./human-answers.ts";
import {
  checkKioskGrants,
  checkKioskRole,
  kioskDraftFor,
  kioskNameScope,
  kiosksByAgent,
  placeKiosk,
  seesAgent,
} from "./kiosk/placements.ts";
import { defaultKioskSoul } from "./kiosk/prompt.ts";
import { checkMessageRate } from "./message-rate.ts";
import type { MindService } from "./mind/people.ts";
import type { HumanRequests } from "./requests.ts";
import { runsOnChoices } from "./runs-on.ts";
import type { AgentRuntime } from "./runtime.ts";
import type { RoomScopes } from "./scope.ts";
import type { OfficeAgentRow, OfficeAgentStore } from "./store.ts";
import type { OfficeAgentTokens } from "./tokens.ts";
import { agentView, type ViewExtras } from "./view.ts";

export type CreateInput = z.output<typeof CreateOfficeAgent>;
export type UpdateInput = z.output<typeof UpdateOfficeAgent>;

export interface OfficeAgentServiceDeps extends ViewExtras {
  store: OfficeAgentStore;
  tokens: OfficeAgentTokens;
  runtime: AgentRuntime;
  conversations: Conversations;
  requests: HumanRequests;
  credentials: AgentCredentials;
  scopes: RoomScopes;
  /** The soul's own writer: the instructions are its text (#136). */
  minds: Pick<MindService, "checkText" | "saveSoul">;
  /** The office PM was created, changed or removed: helpers that run like it start anew (#56). */
  pmChanged?: () => Promise<void>;
  /** A person started their conversation with an agent over: what hung on it goes (#56). */
  startedOver?: (agentId: string, userId: string) => void;
  now?: () => number;
}

const notFound = () => new AuthHttpError(404, "not_found");
const conflict = (code: string) => new AuthHttpError(409, code);

export class OfficeAgentService {
  constructor(private readonly deps: OfficeAgentServiceDeps) {}

  // ---- Reading -----------------------------------------------------------------

  list(actor: OperationActor): OfficeAgentsResponse {
    const { db } = this.deps.store;
    const kiosks = kiosksByAgent(db);
    return {
      agents: this.deps.store
        .list()
        .filter((row) => seesAgent(db, actor, row, kiosks.get(row.id)))
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
    if (!row || !seesAgent(this.deps.store.db, actor, row)) throw notFound();
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

  /** One of these is the office's PM: tell the helpers that run like it. */
  async #pmChanged(...rows: OfficeAgentRow[]): Promise<void> {
    if (rows.some((r) => r.ownerUserId === null && r.role === "pm")) await this.deps.pmChanged?.();
  }

  // ---- Configuration -------------------------------------------------------------

  create(actor: OperationActor, input: CreateInput): OfficeAgentView {
    const { store } = this.deps;
    if (!mayCreateOfficeAgent(actor, input.owner)) {
      throw forbidden(input.owner === "office" ? "owner_or_admin_required" : "viewers_cannot");
    }
    const ownerUserId = input.owner === "office" ? null : actor.id;
    // A board helper needs a board in a room its placer can see (#56).
    const kiosk = kioskDraftFor(store.db, actor, input);
    // A helper's name is unique in its room: a name somebody cannot see is not "taken" for them.
    const nameScope = kiosk ? kioskNameScope(kiosk.placement.operationId) : undefined;
    if (store.nameTaken(input.name, nameScope)) throw conflict("name_taken");
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
      appearance: input.appearance ?? defaultOfficeAgentAppearance(input.role),
      instructions:
        kiosk && !input.instructions.trim()
          ? defaultKioskSoul(kiosk.placement.board)
          : input.instructions,
      createdBy: actor.id,
    };
    checkAgentConfig(this.deps, draft);
    this.deps.minds.checkText(draft.instructions);
    const row = store.insert(store.db, draft, nameScope);
    if (kiosk) placeKiosk(store, row.id, kiosk);
    // Version 1 of its soul (not awaited: a new agent is not running).
    void this.deps.minds
      .saveSoul(actor, row.id, { content: draft.instructions }, "created")
      .catch(() => {});
    this.#audit(actor, AUDIT_ACTIONS.officeAgentCreate, row.id, {
      name: row.name,
      shared: ownerUserId === null,
      engine: row.engine,
      role: row.role,
      preset: row.preset,
      provider: row.provider,
      model: row.model,
      appearance: row.appearance,
      ...(kiosk ? { operationId: kiosk.placement.operationId, board: kiosk.placement.board } : {}),
    });
    void this.#pmChanged(row);
    return this.view(actor, row);
  }

  async update(actor: OperationActor, id: string, patch: UpdateInput): Promise<OfficeAgentView> {
    const { store, runtime } = this.deps;
    const row = this.#configurable(actor, id);
    if (patch.role !== undefined) checkKioskRole(row, patch.role);
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
    checkAgentConfig(this.deps, next, next);
    // The soul is saved by its own writer: a version, its audit entry, and a stop if it runs.
    if (patch.instructions !== undefined) {
      await this.deps.minds.saveSoul(actor, row.id, { content: patch.instructions });
    }
    // The engine holds the configuration it was started with: stop it, the next message starts it anew.
    // Its looks are not part of that: changing only the appearance leaves it running.
    const restart = Object.keys(patch).some(
      (key) => key !== "appearance" && key !== "instructions",
    );
    if (restart && runtime.isRunning(row.id)) {
      await runtime.stop(row.id, row.engine, "configuration changed");
    }
    const saved = store.update(row.id, {
      role: next.role,
      preset: next.preset,
      model: next.model,
      effort: next.effort,
      profileId: next.profileId,
      appearance: next.appearance,
    });
    if (!saved) throw notFound();
    if (restart) await this.#pmChanged(row, saved);
    this.#audit(actor, AUDIT_ACTIONS.officeAgentUpdate, row.id, {
      fields: Object.keys(patch),
      ...(patch.preset !== undefined ? { preset: patch.preset } : {}),
    });
    return this.view(actor, saved);
  }

  /** Whoever configures it removes it; an office admin may remove anyone's personal agent, unread (audited). */
  async remove(actor: OperationActor, id: string): Promise<void> {
    const row = this.#visible(actor, id);
    if (!mayRemoveOfficeAgent(actor, row)) throw forbidden("not_your_agent");
    const byAdmin = !mayConfigureOfficeAgent(actor, row);
    await this.deps.runtime.stop(row.id, row.engine);
    // Its soul, memories, notes, conversations and tokens go with it (cascade).
    this.deps.store.delete(row.id);
    await this.#pmChanged(row);
    this.#audit(
      actor,
      byAdmin ? AUDIT_ACTIONS.officeAgentAdminRemove : AUDIT_ACTIONS.officeAgentDelete,
      row.id,
      { name: row.name, shared: row.ownerUserId === null, ownerUserId: row.ownerUserId },
    );
  }

  setGrants(actor: OperationActor, id: string, grants: readonly OfficeAgentGrant[]) {
    const row = this.#configurable(actor, id);
    if (row.ownerUserId !== null) {
      // A personal agent has its owner's access, nothing can be granted on top.
      throw new AuthHttpError(400, "personal_agents_have_no_grants");
    }
    checkKioskGrants(this.deps.store.db, row, grants);
    const merged = grantsAsSetBy(this.deps.store, actor, row.id, grants);
    if (!this.deps.store.setGrants(row.id, merged)) {
      throw new AuthHttpError(400, "unknown_operation");
    }
    this.#audit(actor, AUDIT_ACTIONS.officeAgentGrantsSet, row.id, { grants });
    return this.view(actor, row);
  }

  mintToken(actor: OperationActor, id: string, label: string): OfficeAgentTokenCreated {
    const row = this.#configurable(actor, id);
    const minted = this.deps.tokens.mint(row.id, "api", label, actor.id);
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
    // A person stopped it: until it is started again it has no body in the world (#301). Written
    // before the stop, so a message that arrives while it stops, and starts it anew, is the later word.
    this.deps.store.update(row.id, { stoppedByPerson: true });
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

  /** The actor's own conversation with the agent begins again (`AgentRuntime.startOver`). */
  startOver(actor: OperationActor, id: string): OfficeAgentConversation {
    const row = this.#talkable(actor, id);
    this.deps.runtime.startOver(row, actor.id);
    this.deps.startedOver?.(row.id, actor.id);
    this.#audit(actor, AUDIT_ACTIONS.officeAgentConversationStartOver, row.id, {
      shared: row.ownerUserId === null,
    });
    return this.conversation(actor, id);
  }

  async send(actor: OperationActor, id: string, text: string): Promise<OfficeAgentMessage> {
    const row = this.#talkable(actor, id);
    const person = this.deps.store.person(actor.id);
    if (!person) throw forbidden();
    checkMessageRate(this.deps, row, actor.id);
    try {
      return await this.deps.runtime.deliver(row, person, text);
    } catch (err) {
      if (err instanceof EngineRefusal) throw refused(err, 409);
      throw err;
    }
  }

  // ---- "Ask a human" (human-answers.ts) ---------------------------------------------

  pendingRequests(actor: OperationActor): HumanRequest[] {
    return pendingRequestsFor(this.deps, actor);
  }

  answer(actor: OperationActor, requestId: string, answer: string): Promise<HumanRequest> {
    return answerRequest(this.deps, actor, requestId, answer);
  }
}
