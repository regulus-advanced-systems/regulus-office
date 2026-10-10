/**
 * Conversations between people and office agents (#271): one per agent and
 * person, kept by the office whatever the engine remembers.
 *
 * A *turn* is open from a person's message until the agent's next reply to
 * them. A shared agent may act for a person only while that person's turn is
 * open (tools/actor.ts), so it cannot use someone's rights unasked.
 */
import {
  OFFICE_AGENT_LIMITS,
  type OfficeAgentMessage,
  type OfficeAgentMessageAuthor,
  REACH_NOTICE,
} from "@regulus/protocol";
import { and, desc, eq, gte } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { officeAgentMessages } from "../db/schema/index.ts";

/** The line the office closes a turn with that a restart cut short (#301). */
export const RESTART_LINE =
  "Not answered: the office restarted before the agent replied. Send your message again.";

/** A message nobody answered stops opening a turn after this long. */
export const TURN_MAX_AGE_MS = 12 * 60 * 60_000;

type Row = typeof officeAgentMessages.$inferSelect;

const view = (row: Row): OfficeAgentMessage => ({
  id: row.id,
  author: row.author,
  text: row.text,
  ts: row.ts.getTime(),
});

export class Conversations {
  /** Called after every stored line with whose conversation it is in (#252: the bubble over the agent). */
  onAppend: ((agentId: string, userId: string) => void) | undefined;

  constructor(
    private readonly db: Db,
    private readonly now: () => number = Date.now,
  ) {}

  append(
    agentId: string,
    userId: string,
    author: OfficeAgentMessageAuthor,
    text: string,
  ): OfficeAgentMessage {
    const row = this.db
      .insert(officeAgentMessages)
      .values({
        agentId,
        userId,
        author,
        text: text.slice(0, OFFICE_AGENT_LIMITS.messageMax),
        ts: new Date(this.now()),
      })
      .returning()
      .get();
    this.onAppend?.(agentId, userId);
    return view(row);
  }

  /** The latest messages of one person's conversation with an agent, oldest first. */
  recent(agentId: string, userId: string, limit: number = OFFICE_AGENT_LIMITS.conversationPage) {
    return this.db
      .select()
      .from(officeAgentMessages)
      .where(and(eq(officeAgentMessages.agentId, agentId), eq(officeAgentMessages.userId, userId)))
      .orderBy(desc(officeAgentMessages.ts), desc(officeAgentMessages.createdAt))
      .limit(limit)
      .all()
      .reverse()
      .map(view);
  }

  /**
   * The person's own messages to the agent since `since`, oldest first (for
   * the hourly limit on shared agents).
   */
  sentSince(agentId: string, userId: string, since: number): number[] {
    return this.db
      .select({ ts: officeAgentMessages.ts })
      .from(officeAgentMessages)
      .where(
        and(
          eq(officeAgentMessages.agentId, agentId),
          eq(officeAgentMessages.userId, userId),
          eq(officeAgentMessages.author, "person"),
          gte(officeAgentMessages.ts, new Date(since)),
        ),
      )
      .orderBy(officeAgentMessages.ts)
      .all()
      .map((r) => r.ts.getTime());
  }

  /**
   * The person's last message to the agent has no answer yet. A system line
   * after it ("Not delivered: ...", the engine's "did not answer") ends the
   * turn like a reply does (#301): a message that failed leaves nobody waiting.
   * A notice the office adds while the agent is still working (`REACH_NOTICE`)
   * is not an end.
   */
  waiting(agentId: string, userId: string): boolean {
    const last = this.db
      .select({
        author: officeAgentMessages.author,
        ts: officeAgentMessages.ts,
        text: officeAgentMessages.text,
      })
      .from(officeAgentMessages)
      .where(and(eq(officeAgentMessages.agentId, agentId), eq(officeAgentMessages.userId, userId)))
      .orderBy(desc(officeAgentMessages.ts), desc(officeAgentMessages.createdAt))
      .limit(8)
      .all()
      .find((line) => !(line.author === "system" && line.text === REACH_NOTICE));
    return last?.author === "person" && this.now() - last.ts.getTime() <= TURN_MAX_AGE_MS;
  }

  /** Tell the person, once in a row, that the agent was refused because of what this conversation has read. */
  noticeReach(agentId: string, userId: string): void {
    const last = this.recent(agentId, userId, 1)[0];
    if (last?.author === "system" && last.text === REACH_NOTICE) return;
    this.append(agentId, userId, "system", REACH_NOTICE);
  }

  /**
   * After an office restart no turn is running any more: everyone whose
   * message was still unanswered is told so, instead of waiting for a reply
   * that cannot come (#301).
   */
  closeOpenTurns(): number {
    const since = new Date(this.now() - TURN_MAX_AGE_MS);
    const pairs = this.db
      .selectDistinct({ agentId: officeAgentMessages.agentId, userId: officeAgentMessages.userId })
      .from(officeAgentMessages)
      .where(gte(officeAgentMessages.ts, since))
      .all();
    let closed = 0;
    for (const { agentId, userId } of pairs) {
      if (!this.waiting(agentId, userId)) continue;
      this.append(agentId, userId, "system", RESTART_LINE);
      closed += 1;
    }
    return closed;
  }
}
