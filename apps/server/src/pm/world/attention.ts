/**
 * What an office agent wants from one person (#252), for the bubble over it:
 * the open question it put to them, a reply they have not read, or an answer
 * it still owes them. Always about the asking person's own conversations;
 * nobody learns anything here about anyone else's.
 */
import type { OfficeAgentAttentionEntry } from "@regulus/protocol";
import { and, eq, max } from "drizzle-orm";
import type { Db } from "../../db/index.ts";
import { officeAgentMessages, officeAgentReads } from "../../db/schema/index.ts";
import type { Conversations } from "../conversations.ts";
import type { HumanRequests } from "../requests.ts";

export class AgentAttention {
  constructor(
    private readonly db: Db,
    private readonly conversations: Conversations,
    private readonly requests: HumanRequests,
    private readonly now: () => number = Date.now,
  ) {}

  /** The person has read their conversation with the agent up to now. */
  markSeen(agentId: string, userId: string): void {
    const seenAt = new Date(this.now());
    this.db
      .insert(officeAgentReads)
      .values({ agentId, userId, seenAt })
      .onConflictDoUpdate({
        target: [officeAgentReads.agentId, officeAgentReads.userId],
        set: { seenAt },
      })
      .run();
  }

  /** Entries for the agents (of `agentIds`) that want something from the person. */
  for(userId: string, agentIds: ReadonlySet<string>): OfficeAgentAttentionEntry[] {
    const lastReply = new Map<string, number>();
    for (const row of this.db
      .select({ agentId: officeAgentMessages.agentId, ts: max(officeAgentMessages.ts) })
      .from(officeAgentMessages)
      .where(and(eq(officeAgentMessages.userId, userId), eq(officeAgentMessages.author, "agent")))
      .groupBy(officeAgentMessages.agentId)
      .all()) {
      if (row.ts) lastReply.set(row.agentId, row.ts.getTime());
    }
    const seen = new Map<string, number>();
    for (const row of this.db
      .select({ agentId: officeAgentReads.agentId, seenAt: officeAgentReads.seenAt })
      .from(officeAgentReads)
      .where(eq(officeAgentReads.userId, userId))
      .all()) {
      seen.set(row.agentId, row.seenAt.getTime());
    }
    const questions = new Map<string, string>();
    for (const request of this.requests.pendingFor(userId)) {
      if (!questions.has(request.agentId)) questions.set(request.agentId, request.question);
    }
    const out: OfficeAgentAttentionEntry[] = [];
    for (const agentId of agentIds) {
      const question = questions.get(agentId);
      const unread = (lastReply.get(agentId) ?? 0) > (seen.get(agentId) ?? 0);
      const waiting = this.conversations.waiting(agentId, userId);
      if (question === undefined && !unread && !waiting) continue;
      out.push({ agentId, ...(question !== undefined ? { question } : {}), unread, waiting });
    }
    return out;
  }
}
