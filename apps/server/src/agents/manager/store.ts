/**
 * Persistence for the AgentManager: `agents` rows, desk occupancy, the
 * `agent_events` log with rolling retention (SPEC §5), and audit entries.
 *
 * Nothing secret is written here: SpawnRequest credentials never reach this
 * module, events are schema-validated protocol shapes (which carry no env),
 * and `spawnArgsJson` is built from the command minus any credential.
 */
import type { AgentEvent, AgentStatus } from "@regulus/protocol";
import { and, asc, eq, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { type AuditAction, writeAudit } from "../../auth/audit.ts";
import type { Db } from "../../db/index.ts";
import { agentEvents, agents, desks, userProfiles } from "../../db/schema/index.ts";
import { AgentManagerError } from "./errors.ts";

export type AgentRow = typeof agents.$inferSelect;
export type NewAgentRow = typeof agents.$inferInsert;

export interface RetentionPolicy {
  /** Keep at most this many events per agent (newest win). */
  maxEventsPerAgent: number;
  /** Drop events older than this. */
  maxAgeMs: number;
  /** Prune an agent's log every this many appends. */
  pruneEvery: number;
}

export const DEFAULT_RETENTION: RetentionPolicy = {
  maxEventsPerAgent: 2000,
  maxAgeMs: 7 * 24 * 60 * 60 * 1000,
  pruneEvery: 100,
};

export class AgentStore {
  readonly #appends = new Map<string, number>();

  constructor(
    readonly db: Db,
    readonly retention: RetentionPolicy = DEFAULT_RETENTION,
    private readonly now: () => number = Date.now,
  ) {}

  get(agentId: string): AgentRow | undefined {
    return this.db.select().from(agents).where(eq(agents.id, agentId)).get();
  }

  /**
   * Insert the agent and claim its desk atomically: the requested seat when
   * given (must exist on the floor and be free), else the first free seat.
   * Returns the seat id.
   */
  insertWithDesk(row: NewAgentRow & { id: string }, seatId: string | undefined): string {
    return this.db.transaction((tx) => {
      const free = tx
        .select({ seatId: desks.seatId, agentId: desks.agentId })
        .from(desks)
        .where(eq(desks.floorId, row.floorId))
        .orderBy(asc(desks.seatId))
        .all();
      let seat: string | undefined;
      if (seatId !== undefined) {
        const desk = free.find((d) => d.seatId === seatId);
        if (!desk) throw new AgentManagerError("bad_request", "no such desk in this operation");
        if (desk.agentId) throw new AgentManagerError("conflict", "desk is taken");
        seat = seatId;
      } else {
        seat = free.find((d) => !d.agentId)?.seatId;
        if (!seat) throw new AgentManagerError("conflict", "no free desk in this operation");
      }
      tx.insert(agents)
        .values({ ...row, deskSeatId: seat })
        .run();
      const claimed = tx
        .update(desks)
        .set({ agentId: row.id })
        .where(and(eq(desks.floorId, row.floorId), eq(desks.seatId, seat), isNull(desks.agentId)))
        .returning({ id: desks.id })
        .all();
      if (claimed.length !== 1) throw new AgentManagerError("conflict", "desk is taken");
      return seat;
    });
  }

  update(agentId: string, patch: Partial<NewAgentRow>): void {
    this.db.update(agents).set(patch).where(eq(agents.id, agentId)).run();
  }

  setStatus(agentId: string, status: AgentStatus, at: number): void {
    const patch: Partial<NewAgentRow> = { status, lastActivityAt: new Date(at) };
    if (status === "exited") patch.exitedAt = new Date(at);
    if (status === "starting") patch.exitedAt = null;
    this.update(agentId, patch);
  }

  /** Free the agent's desk (send home). */
  freeDesk(agentId: string): void {
    this.db.update(desks).set({ agentId: null }).where(eq(desks.agentId, agentId)).run();
  }

  /** Agents that hold a desk, i.e. robots in the world (re-published on boot). */
  seated(): AgentRow[] {
    return this.db
      .select({ agent: agents })
      .from(agents)
      .innerJoin(desks, eq(desks.agentId, agents.id))
      .where(isNotNull(desks.agentId))
      .all()
      .map((r) => r.agent);
  }

  ownerName(userId: string): string {
    const row = this.db
      .select({ name: userProfiles.displayName })
      .from(userProfiles)
      .where(eq(userProfiles.userId, userId))
      .get();
    return row?.name ?? "";
  }

  /** Append one event; prunes this agent's log every `pruneEvery` appends. */
  appendEvent(agentId: string, event: AgentEvent): void {
    this.db
      .insert(agentEvents)
      .values({
        agentId,
        ts: new Date(eventTs(event)),
        kind: event.kind,
        payloadJson: JSON.stringify(event),
      })
      .run();
    const n = (this.#appends.get(agentId) ?? 0) + 1;
    this.#appends.set(agentId, n % this.retention.pruneEvery);
    if (n >= this.retention.pruneEvery) this.prune(agentId);
  }

  /** Apply the retention policy to one agent's log. */
  prune(agentId: string): void {
    const cutoff = new Date(this.now() - this.retention.maxAgeMs);
    this.db
      .delete(agentEvents)
      .where(and(eq(agentEvents.agentId, agentId), lt(agentEvents.ts, cutoff)))
      .run();
    this.db.run(sql`
      delete from ${agentEvents}
      where ${agentEvents.agentId} = ${agentId}
        and ${agentEvents.id} not in (
          select ${agentEvents.id} from ${agentEvents}
          where ${agentEvents.agentId} = ${agentId}
          order by ${agentEvents.ts} desc, ${agentEvents.createdAt} desc
          limit ${this.retention.maxEventsPerAgent}
        )`);
  }

  /** Age-based sweep over every agent (boot and periodic). */
  sweep(): void {
    const cutoff = new Date(this.now() - this.retention.maxAgeMs);
    this.db.delete(agentEvents).where(lt(agentEvents.ts, cutoff)).run();
  }

  events(agentId: string, limit = 200): AgentEvent[] {
    return this.db
      .select({ payload: agentEvents.payloadJson })
      .from(agentEvents)
      .where(eq(agentEvents.agentId, agentId))
      .orderBy(asc(agentEvents.ts), asc(agentEvents.createdAt))
      .limit(limit)
      .all()
      .map((r) => JSON.parse(r.payload) as AgentEvent);
  }

  audit(
    userId: string | null,
    action: AuditAction,
    agentId: string,
    meta?: Record<string, unknown>,
  ): void {
    writeAudit(this.db, { userId, action, targetKind: "agent", targetId: agentId, meta });
  }
}

function eventTs(event: AgentEvent): number {
  return "ts" in event ? event.ts : Date.now();
}
