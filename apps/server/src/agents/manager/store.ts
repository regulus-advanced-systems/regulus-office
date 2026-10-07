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
import { pickHenchmanName } from "../names/names.ts";
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
    /** Chooses among the free henchman names (tests pin it). */
    private readonly random: () => number = Math.random,
  ) {}

  get(agentId: string): AgentRow | undefined {
    return this.db.select().from(agents).where(eq(agents.id, agentId)).get();
  }

  /**
   * Insert the agent and claim its desk atomically: the requested seat when
   * given (must exist on the operation and be free), else the first free seat.
   * The henchman is named in the same transaction (D29, #256): a name no
   * henchman at a desk anywhere in the office holds. Returns the seat and the name.
   */
  insertWithDesk(
    row: NewAgentRow & { id: string },
    seatId: string | undefined,
  ): { seatId: string; name: string } {
    return this.db.transaction((tx) => {
      const free = tx
        .select({ seatId: desks.seatId, agentId: desks.agentId })
        .from(desks)
        .where(eq(desks.operationId, row.operationId))
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
      const name = pickHenchmanName(livingNames(tx), this.random);
      tx.insert(agents)
        .values({ ...row, name, deskSeatId: seat })
        .run();
      const claimed = tx
        .update(desks)
        .set({ agentId: row.id })
        .where(
          and(
            eq(desks.operationId, row.operationId),
            eq(desks.seatId, seat),
            isNull(desks.agentId),
          ),
        )
        .returning({ id: desks.id })
        .all();
      if (claimed.length !== 1) throw new AgentManagerError("conflict", "desk is taken");
      return { seatId: seat, name };
    });
  }

  /**
   * The name of a row from before henchmen had names: given once, on first
   * sight after the upgrade, and kept from then on. Rows that have one keep it.
   */
  ensureName(agentId: string): string {
    return this.db.transaction((tx) => {
      const row = tx.select({ name: agents.name }).from(agents).where(eq(agents.id, agentId)).get();
      if (!row) return "";
      if (row.name) return row.name;
      const name = pickHenchmanName(livingNames(tx), this.random);
      tx.update(agents).set({ name }).where(eq(agents.id, agentId)).run();
      return name;
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

  /** Agents that hold a desk, i.e. henchmen in the world (re-published on boot). */
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

/** Names held by henchmen at a desk (the living ones), office-wide. */
function livingNames(tx: Pick<Db, "select">): string[] {
  return tx
    .select({ name: agents.name })
    .from(agents)
    .innerJoin(desks, eq(desks.agentId, agents.id))
    .all()
    .map((r) => r.name)
    .filter(Boolean);
}

function eventTs(event: AgentEvent): number {
  return "ts" in event ? event.ts : Date.now();
}
