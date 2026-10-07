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
} from "@regulus/protocol";
import { and, desc, eq, ne } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { officeAgentMessages } from "../db/schema/index.ts";

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
    return view(row);
  }

  /** The latest messages of one person's conversation with an agent, oldest first. */
  recent(agentId: string, userId: string, limit = OFFICE_AGENT_LIMITS.conversationPage) {
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

  /** The person's last message to the agent has no answer yet (system lines do not count). */
  waiting(agentId: string, userId: string): boolean {
    const last = this.db
      .select({ author: officeAgentMessages.author, ts: officeAgentMessages.ts })
      .from(officeAgentMessages)
      .where(
        and(
          eq(officeAgentMessages.agentId, agentId),
          eq(officeAgentMessages.userId, userId),
          ne(officeAgentMessages.author, "system"),
        ),
      )
      .orderBy(desc(officeAgentMessages.ts), desc(officeAgentMessages.createdAt))
      .limit(1)
      .get();
    return last?.author === "person" && this.now() - last.ts.getTime() <= TURN_MAX_AGE_MS;
  }
}
