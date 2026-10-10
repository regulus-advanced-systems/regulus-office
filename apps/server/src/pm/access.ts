/**
 * What an office agent may reach (SPEC §10 M5, D27, D28, D32; #271).
 *
 * A personal agent has no rights of its own: every check is made as its
 * owner, as they are at that moment (role and operation membership read from
 * the database on each call), through the office's operation access gate
 * (`operationAccessFor`). Whatever that gate learns to check later (levels,
 * GitHub-based access, #251 part D) applies to personal agents without a
 * change here. An owner who is gone leaves the agent with nothing.
 *
 * A shared agent has the operations its admins granted it (live operations
 * only). When it acts for a person (`onBehalfOf`), the result is the lower of
 * its grant and that person's own access, so it never does for someone what
 * they could not do themselves.
 *
 * A board helper (#56) is a shared agent that reaches its own room and no
 * other, whatever its grants say, and nothing at all without a placement.
 */
import type { OperationAccess, UserRole } from "@regulus/protocol";
import { asc, eq, isNull } from "drizzle-orm";
import { AuthHttpError, forbidden } from "../auth/errors.ts";
import { officeAgentKiosks, operations } from "../db/schema/index.ts";
import {
  accessibleOperations,
  type OperationActor,
  operationAccessFor,
} from "../operations/access.ts";
import type { OfficeAgentRow, OfficeAgentStore } from "./store.ts";

export interface AgentPerson extends OperationActor {
  role: UserRole;
  displayName: string;
}

const RANK: Readonly<Record<OperationAccess, number>> = { view: 1, spawn: 2, manage: 3 };

/** The lower of two accesses; null when either is missing. */
export function lowerAccess(
  a: OperationAccess | null,
  b: OperationAccess | null,
): OperationAccess | null {
  if (!a || !b) return null;
  return RANK[a] <= RANK[b] ? a : b;
}

export const accessAtLeast = (access: OperationAccess | null, needed: OperationAccess): boolean =>
  access !== null && RANK[access] >= RANK[needed];

/**
 * The grants of a shared agent after `actor` sets `grants` (D27; #270). A
 * person gives a shared agent only what they have themselves: a room they
 * cannot see is "unknown" to them, and no more access than their own. Grants
 * on rooms they cannot see were set by someone who can, and stay as they are.
 */
export function grantsAsSetBy(
  store: OfficeAgentStore,
  actor: OperationActor,
  agentId: string,
  grants: ReadonlyArray<{ operationId: string; access: OperationAccess }>,
): Array<{ operationId: string; access: OperationAccess }> {
  const mine = accessibleOperations(store.db, actor);
  for (const grant of grants) {
    const own = mine.get(grant.operationId);
    if (!own) throw new AuthHttpError(400, "unknown_operation");
    if (RANK[grant.access] > RANK[own]) throw forbidden("grant_exceeds_your_access");
  }
  const kept = store.grants(agentId).filter((g) => !mine.has(g.operationId));
  return [...kept, ...grants];
}

export class AgentAccess {
  constructor(private readonly store: OfficeAgentStore) {}

  /** The room a board helper stands in; undefined when it has no placement. */
  #kioskRoom(agentId: string): string | undefined {
    return this.store.db
      .select({ operationId: officeAgentKiosks.operationId })
      .from(officeAgentKiosks)
      .where(eq(officeAgentKiosks.agentId, agentId))
      .get()?.operationId;
  }

  /** The owner of a personal agent as they are now; null for a shared agent or a vanished owner. */
  owner(agent: OfficeAgentRow): AgentPerson | null {
    if (agent.ownerUserId === null) return null;
    return this.store.person(agent.ownerUserId) ?? null;
  }

  /**
   * The agent's access to a live operation right now, or null. `forPerson` is the
   * person a shared agent acts for; it is ignored for personal agents, which
   * only ever act as their owner.
   */
  operation(
    agent: OfficeAgentRow,
    operationId: string,
    forPerson?: OperationActor,
  ): OperationAccess | null {
    if (agent.ownerUserId !== null) {
      const owner = this.owner(agent);
      return owner ? operationAccessFor(this.store.db, owner, operationId) : null;
    }
    if (agent.role === "kiosk" && this.#kioskRoom(agent.id) !== operationId) return null;
    const grant = this.store.grantFor(agent.id, operationId);
    if (!forPerson) return grant;
    return lowerAccess(grant, operationAccessFor(this.store.db, forPerson, operationId));
  }

  /** Every live operation open to the agent, with its access. */
  operations(agent: OfficeAgentRow): Array<{ operationId: string; access: OperationAccess }> {
    if (agent.ownerUserId === null) {
      const grants = this.store.grants(agent.id);
      if (agent.role !== "kiosk") return grants;
      const room = this.#kioskRoom(agent.id);
      return grants.filter((g) => g.operationId === room);
    }
    const owner = this.owner(agent);
    if (!owner) return [];
    const out: Array<{ operationId: string; access: OperationAccess }> = [];
    const live = this.store.db
      .select({ id: operations.id })
      .from(operations)
      .where(isNull(operations.archivedAt))
      .orderBy(asc(operations.createdAt))
      .all();
    for (const { id } of live) {
      const access = operationAccessFor(this.store.db, owner, id);
      if (access) out.push({ operationId: id, access });
    }
    return out;
  }
}
