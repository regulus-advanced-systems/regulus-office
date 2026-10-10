/**
 * What people do with an office agent's body (#252): the owner of a personal
 * agent dismisses it (it goes off to wander) and recalls it (it comes back to
 * their side), and everyone reads what their own agents want from them.
 *
 * Only the person a personal agent belongs to may dismiss or recall it (D32):
 * an office admin who sees its card gets 403, anyone else 404, as for every
 * other thing done to someone's agent. A shared agent wanders anyway and
 * cannot be dismissed. Both are audited.
 */
import {
  mayConfigureOfficeAgent,
  mayTalkToOfficeAgent,
  type OfficeAgentAttention,
  type OfficeAgentView,
} from "@regulus/protocol";
import { AUDIT_ACTIONS, writeAudit } from "../../auth/audit.ts";
import { AuthHttpError, forbidden } from "../../auth/errors.ts";
import type { OperationActor } from "../../operations/access.ts";
import { kiosksByAgent, seesAgent } from "../kiosk/placements.ts";
import type { OfficeAgentRow, OfficeAgentStore } from "../store.ts";
import type { AgentAttention } from "./attention.ts";

export interface AgentWorldServiceDeps {
  store: OfficeAgentStore;
  attention: AgentAttention;
  view(actor: OperationActor, row: OfficeAgentRow): OfficeAgentView;
  /** The agent list changed: the world re-reads it. */
  changed(): void;
  /** Something in this person's attention list changed. */
  notify(userId: string): void;
}

const notFound = () => new AuthHttpError(404, "not_found");

export class AgentWorldService {
  constructor(private readonly deps: AgentWorldServiceDeps) {}

  #owned(actor: OperationActor, id: string): OfficeAgentRow {
    const row = this.deps.store.get(id);
    if (!row || !seesAgent(this.deps.store.db, actor, row)) throw notFound();
    if (row.ownerUserId === null) throw new AuthHttpError(400, "shared_agents_wander");
    if (!mayConfigureOfficeAgent(actor, row)) throw forbidden("not_your_agent");
    return row;
  }

  #setDismissed(actor: OperationActor, id: string, dismissed: boolean): OfficeAgentView {
    const row = this.#owned(actor, id);
    const saved = this.deps.store.update(row.id, { dismissed }) ?? row;
    if (row.dismissed !== dismissed) {
      writeAudit(this.deps.store.db, {
        userId: actor.id,
        action: dismissed ? AUDIT_ACTIONS.officeAgentDismiss : AUDIT_ACTIONS.officeAgentRecall,
        targetKind: "office_agent",
        targetId: row.id,
        meta: {},
      });
      this.deps.changed();
    }
    return this.deps.view(actor, saved);
  }

  dismiss(actor: OperationActor, id: string): OfficeAgentView {
    return this.#setDismissed(actor, id, true);
  }

  recall(actor: OperationActor, id: string): OfficeAgentView {
    return this.#setDismissed(actor, id, false);
  }

  /** The actor has read their own conversation with the agent. */
  seen(actor: OperationActor, id: string): void {
    const row = this.deps.store.get(id);
    if (!row || !seesAgent(this.deps.store.db, actor, row)) throw notFound();
    if (!mayTalkToOfficeAgent(actor, row)) {
      throw forbidden(row.ownerUserId === null ? "viewers_cannot" : "not_your_agent");
    }
    this.deps.attention.markSeen(row.id, actor.id);
    this.deps.notify(actor.id);
  }

  /** What the actor's agents (the ones they may talk to) want from them. */
  attention(actor: OperationActor): OfficeAgentAttention {
    const { db } = this.deps.store;
    const kiosks = kiosksByAgent(db);
    const mine = new Set(
      this.deps.store
        .list()
        // Not a board helper of a room this person cannot see (#56).
        .filter((row) => seesAgent(db, actor, row, kiosks.get(row.id)))
        .filter((row) => mayTalkToOfficeAgent(actor, row))
        .map((row) => row.id),
    );
    return { agents: this.deps.attention.for(actor.id, mine) };
  }
}
