/**
 * "Ask a human" (#271): a question an office agent put to one person. The
 * record is all there is here; Settings lists and answers it today and the
 * bubble over the agent (#256) will read the same rows.
 */
import { type HumanRequest, OFFICE_AGENT_LIMITS } from "@regulus/protocol";
import { and, asc, eq } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { officeAgentRequests, officeAgents } from "../db/schema/index.ts";
import { roomsJson, roomsOf } from "./mind/store.ts";

/** Unanswered questions one agent may have open for one person. */
export const MAX_PENDING_PER_PERSON = 5;

type Row = typeof officeAgentRequests.$inferSelect;

const options = (json: string): string[] => {
  try {
    const v = JSON.parse(json) as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
};

const view = (row: Row, agentName: string): HumanRequest => ({
  id: row.id,
  agentId: row.agentId,
  agentName,
  forUserId: row.forUserId,
  question: row.question,
  options: options(row.optionsJson),
  ...(row.operationId ? { operationId: row.operationId } : {}),
  status: row.status,
  ...(row.answer !== null ? { answer: row.answer } : {}),
  createdAt: row.createdAt.getTime(),
  ...(row.answeredAt ? { answeredAt: row.answeredAt.getTime() } : {}),
});

export class HumanRequests {
  /** Called when a person's open questions changed (#252: the bubble over the agent). */
  onChange: ((userId: string) => void) | undefined;

  constructor(
    private readonly db: Db,
    private readonly now: () => number = Date.now,
  ) {}

  #select() {
    return this.db
      .select({ row: officeAgentRequests, agentName: officeAgents.name })
      .from(officeAgentRequests)
      .innerJoin(officeAgents, eq(officeAgents.id, officeAgentRequests.agentId));
  }

  /** Null when the agent already has too many questions open for that person. */
  create(input: {
    agentId: string;
    forUserId: string;
    question: string;
    options: readonly string[];
    operationId?: string;
    /** The rooms the question may be about (#301): the one it names and those its conversation read. */
    rooms?: readonly string[];
  }): HumanRequest | null {
    const open = this.db
      .select({ id: officeAgentRequests.id })
      .from(officeAgentRequests)
      .where(
        and(
          eq(officeAgentRequests.agentId, input.agentId),
          eq(officeAgentRequests.forUserId, input.forUserId),
          eq(officeAgentRequests.status, "pending"),
        ),
      )
      .all();
    if (open.length >= MAX_PENDING_PER_PERSON) return null;
    const row = this.db
      .insert(officeAgentRequests)
      .values({
        agentId: input.agentId,
        forUserId: input.forUserId,
        question: input.question.slice(0, OFFICE_AGENT_LIMITS.questionMax),
        optionsJson: JSON.stringify(input.options),
        operationId: input.operationId ?? null,
        roomScope: roomsJson(input.rooms ?? (input.operationId ? [input.operationId] : [])),
      })
      .returning()
      .get();
    this.onChange?.(input.forUserId);
    return this.get(row.id) ?? null;
  }

  get(id: string): HumanRequest | undefined {
    const found = this.#select().where(eq(officeAgentRequests.id, id)).get();
    return found ? view(found.row, found.agentName) : undefined;
  }

  /** The rooms a question may be about (#301); empty for one that is gone. */
  roomsOf(id: string): string[] {
    const row = this.db
      .select({
        scope: officeAgentRequests.roomScope,
        operationId: officeAgentRequests.operationId,
      })
      .from(officeAgentRequests)
      .where(eq(officeAgentRequests.id, id))
      .get();
    if (!row) return [];
    return [...new Set([...roomsOf(row.scope), ...(row.operationId ? [row.operationId] : [])])];
  }

  /** The person's unanswered questions, oldest first. */
  pendingFor(userId: string): HumanRequest[] {
    return this.#select()
      .where(
        and(eq(officeAgentRequests.forUserId, userId), eq(officeAgentRequests.status, "pending")),
      )
      .orderBy(asc(officeAgentRequests.createdAt))
      .all()
      .map((r) => view(r.row, r.agentName));
  }

  /** Answer a pending request; undefined when it was not pending any more. */
  answer(id: string, answer: string): HumanRequest | undefined {
    const changed = this.db
      .update(officeAgentRequests)
      .set({ status: "answered", answer, answeredAt: new Date(this.now()) })
      .where(and(eq(officeAgentRequests.id, id), eq(officeAgentRequests.status, "pending")))
      .returning({ id: officeAgentRequests.id, forUserId: officeAgentRequests.forUserId })
      .all();
    for (const row of changed) this.onChange?.(row.forUserId);
    return changed.length > 0 ? this.get(id) : undefined;
  }

  /** The agent's open questions are void once it is stopped for good or deleted. */
  cancelFor(agentId: string): void {
    const changed = this.db
      .update(officeAgentRequests)
      .set({ status: "cancelled" })
      .where(
        and(eq(officeAgentRequests.agentId, agentId), eq(officeAgentRequests.status, "pending")),
      )
      .returning({ forUserId: officeAgentRequests.forUserId })
      .all();
    for (const row of changed) this.onChange?.(row.forUserId);
  }
}
