/**
 * Where board helpers stand, and the rules of placing one (SPEC §10 M5, D10,
 * D26, D27, D34; #56).
 *
 * A board helper is a shared office agent with the `kiosk` job and a row in
 * `office_agent_kiosks`. What follows from that row:
 *
 * - `seesAgent`: the agent exists only for people whose own GitHub access
 *   opens its room. Office owners and admins get no exception (D27): a helper
 *   they cannot see is one somebody with access to that room placed, and that
 *   person can change or remove it;
 * - it may be let into its own room and no other (`checkKioskGrants`);
 * - whoever places it gives it no more access than they have themselves, and
 *   never more than `spawn`, which is what queueing a task needs.
 *
 * A helper goes with its room (rooms.ts). Should one ever be left without a
 * placement, it reaches nothing, has no body, nobody but office owners and
 * admins sees it, and it is removed at the next boot.
 *
 * A helper is named after its room, so its name is unique within its room
 * only (`kioskNameScope`): the name of a helper somebody cannot see is never
 * "taken" for them.
 */
import {
  type KioskPlacement,
  type KioskPlacementView,
  maySeeOfficeAgent,
  type OfficeAgentEngineKind,
  type OfficeAgentGrant,
  type OfficeAgentRole,
  type OperationAccess,
} from "@regulus/protocol";
import { and, eq, isNull } from "drizzle-orm";
import { AuthHttpError } from "../../auth/errors.ts";
import type { Db } from "../../db/index.ts";
import { officeAgentKiosks, operations } from "../../db/schema/index.ts";
import {
  isOfficeManager,
  type OperationActor,
  operationAccessFor,
} from "../../operations/access.ts";
import { lowerAccess } from "../access.ts";
import type { OfficeAgentRow, OfficeAgentStore } from "../store.ts";

export type KioskRow = typeof officeAgentKiosks.$inferSelect;

/** The most a helper is ever let do in its room: look, and queue tasks. */
export const KIOSK_MAX_ACCESS: OperationAccess = "spawn";

const bad = (code: string) => new AuthHttpError(400, code);

/** The placement of a helper, whatever the state of its room; undefined for every other agent. */
export function kioskOf(db: Db, agentId: string): KioskRow | undefined {
  return db.select().from(officeAgentKiosks).where(eq(officeAgentKiosks.agentId, agentId)).get();
}

/** Every placement, by agent id (one query, for lists). */
export function kiosksByAgent(db: Db): Map<string, KioskRow> {
  return new Map(
    db
      .select()
      .from(officeAgentKiosks)
      .all()
      .map((row) => [row.agentId, row]),
  );
}

/**
 * May this person know the agent exists? The protocol's rule for every agent,
 * and for a board helper their own access to its room. A helper without a
 * placement is office business only.
 */
export function seesAgent(
  db: Db,
  actor: OperationActor,
  row: Pick<OfficeAgentRow, "id" | "ownerUserId" | "role">,
  placement: KioskRow | undefined = row.role === "kiosk" ? kioskOf(db, row.id) : undefined,
): boolean {
  if (!maySeeOfficeAgent(actor, row)) return false;
  if (row.role !== "kiosk") return true;
  if (!placement) return isOfficeManager(actor.role);
  return operationAccessFor(db, actor, placement.operationId) !== null;
}

/** The office PM a helper's turns can run like: the shared PM, when it runs as a session in the office. */
export function pmToRunLike(store: OfficeAgentStore, row: Pick<OfficeAgentRow, "provider">) {
  const pm = store.ownedBy(null).find((a) => a.role === "pm");
  return pm && pm.engine === "cli-session" && pm.provider === row.provider ? pm : undefined;
}

export function kioskView(
  store: OfficeAgentStore,
  row: OfficeAgentRow,
  placement: KioskRow,
): KioskPlacementView {
  const room = store.db
    .select({ name: operations.name })
    .from(operations)
    .where(eq(operations.id, placement.operationId))
    .get();
  return {
    operationId: placement.operationId,
    operationName: room?.name ?? "",
    board: placement.board,
    viaPm: placement.viaPm,
    runsLikePm: placement.viaPm && pmToRunLike(store, row) !== undefined,
  };
}

/** What a helper's name is unique within: its room. */
export const kioskNameScope = (operationId: string) => `kiosk:${operationId}`;

export interface KioskDraft {
  placement: KioskPlacement;
  /** What it is let do in its room: the lower of `spawn` and the placer's own access. */
  access: OperationAccess;
}

/**
 * Check a new agent's job against its placement. Null for an agent that is
 * not a board helper; throws for a helper that cannot be placed like this.
 */
export function kioskDraftFor(
  db: Db,
  actor: OperationActor,
  input: {
    role: OfficeAgentRole;
    owner: "office" | "me";
    engine: OfficeAgentEngineKind;
    kiosk?: KioskPlacement;
  },
): KioskDraft | null {
  if (input.role !== "kiosk") {
    if (input.kiosk) throw bad("kiosk_placement_unexpected");
    return null;
  }
  if (!input.kiosk) throw bad("kiosk_placement_required");
  // It serves whoever walks up, on the office's key: never one person's agent.
  if (input.owner !== "office") throw bad("kiosk_shared_only");
  // Only the session engine runs an agent with no tools but the office's (cli-plan.ts, `--tools ""`).
  if (input.engine !== "cli-session") throw bad("kiosk_engine");
  const live = db
    .select({ id: operations.id })
    .from(operations)
    .where(and(eq(operations.id, input.kiosk.operationId), isNull(operations.archivedAt)))
    .get();
  // A room the placer cannot see is unknown to them, like one that does not exist (D27).
  const own = live ? operationAccessFor(db, actor, input.kiosk.operationId) : null;
  const access = lowerAccess(KIOSK_MAX_ACCESS, own);
  if (!access) throw bad("unknown_operation");
  const taken = db
    .select({ agentId: officeAgentKiosks.agentId })
    .from(officeAgentKiosks)
    .where(
      and(
        eq(officeAgentKiosks.operationId, input.kiosk.operationId),
        eq(officeAgentKiosks.board, input.kiosk.board),
      ),
    )
    .get();
  if (taken) throw new AuthHttpError(409, "kiosk_board_taken");
  return { placement: input.kiosk, access };
}

/** Store a new helper's placement and let it into its room. */
export function placeKiosk(store: OfficeAgentStore, agentId: string, draft: KioskDraft): void {
  const { operationId, board, viaPm } = draft.placement;
  try {
    store.db.insert(officeAgentKiosks).values({ agentId, operationId, board, viaPm }).run();
  } catch {
    // Someone placed a helper at this board in the same moment: no helper without a board.
    store.delete(agentId);
    throw new AuthHttpError(409, "kiosk_board_taken");
  }
  store.setGrants(agentId, [{ operationId, access: draft.access }]);
}

/**
 * A helper as its engine runs it (`AgentRuntime` `shape`): where it stands,
 * and, when it was placed to run like the office PM and the office has one
 * that runs as a session, the PM's key, model and effort instead of its own
 * (SPEC §10 M5: "as PM agent sub-tasks where the PM is configured, otherwise
 * as standalone restricted agents"). It keeps its own token, tools and room
 * either way: nothing of the PM's reach comes with the PM's model.
 */
export function kioskShape(store: OfficeAgentStore) {
  return <A extends { model: string; effort: string | null; profileId: string | null }>(
    row: OfficeAgentRow,
    agent: A,
  ): A & { kiosk?: { operationId: string; board: KioskRow["board"] } } => {
    if (row.role !== "kiosk") return agent;
    const placement = kioskOf(store.db, row.id);
    if (!placement) return agent;
    const pm = placement.viaPm ? pmToRunLike(store, row) : undefined;
    return {
      ...agent,
      ...(pm ? { model: pm.model, effort: pm.effort, profileId: pm.profileId } : {}),
      kiosk: { operationId: placement.operationId, board: placement.board },
    };
  };
}

/** A job is for life where board helpers are concerned: the placement is made with the agent. */
export function checkKioskRole(row: Pick<OfficeAgentRow, "role">, next: OfficeAgentRole): void {
  if ((row.role === "kiosk") !== (next === "kiosk")) throw bad("kiosk_job_fixed");
}

/** A helper is let into its own room only, and only to look and to queue. */
export function checkKioskGrants(
  db: Db,
  row: Pick<OfficeAgentRow, "id" | "role">,
  grants: readonly OfficeAgentGrant[],
): void {
  if (row.role !== "kiosk") return;
  const placement = kioskOf(db, row.id);
  for (const grant of grants) {
    if (grant.operationId !== placement?.operationId) throw bad("kiosk_one_room");
    if (grant.access === "manage") throw bad("kiosk_one_room");
  }
}
