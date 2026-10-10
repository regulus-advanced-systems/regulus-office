/**
 * Rooms and what a shared agent may pass on (#301; D20, D26, D34).
 *
 * The rule: a shared agent tells a person nothing, and does nothing for them,
 * about a room that person's own GitHub access does not open, whatever rooms
 * the agent itself was granted. The office cannot read an answer and know
 * what it is about, so it works with what it can know for certain:
 *
 * 1. **Who is asking.** A call is answered for the person whose turn's token
 *    it was made with, or, with an access code someone minted, for that
 *    someone; with neither it is refused. Every room that call can read is the
 *    lower of the agent's grant and that person's own access (tools/asking.ts).
 * 2. **What a conversation has seen.** Each room a call read for a person is
 *    recorded here per agent and person (`sawRooms`): it is what may be in
 *    the context of that conversation.
 * 3. **Scope.** Whatever leaves that conversation for somebody else (a memory
 *    or note, a question to another person, a chat line, a comment, a queued
 *    task, a henchman's prompt) carries those rooms
 *    as its scope, and reaches only people who can see every one of them
 *    (`canSeeAll`). Too wide rather than too narrow: something general said in
 *    a conversation that looked at a room is treated as being about that room.
 * 4. **A person who loses a room.** Their conversation with the agent may still
 *    hold it, so before their next message the agent's session with them is
 *    dropped and starts over (`AgentRuntime.deliver`), and with it this record.
 *
 * Rooms are operation ids. A room that is archived or deleted is open to
 * nobody, so what is scoped to it stays closed.
 */
import { and, eq } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { officeAgentRoomReads, userProfiles } from "../db/schema/index.ts";
import { accessibleOperations, type OperationActor } from "../operations/access.ts";

/** Decides whether something scoped to `rooms` may be shown; undefined = no limit applies. */
export type Visible = ((rooms: readonly string[]) => boolean) | undefined;

export class RoomScopes {
  constructor(private readonly db: Db) {}

  /** The rooms open to a person right now, from the access gate. */
  open(person: OperationActor): Set<string> {
    return new Set(accessibleOperations(this.db, person).keys());
  }

  /** True when the person's own access covers every one of `rooms`. */
  canSeeAll(person: OperationActor, rooms: readonly string[]): boolean {
    if (rooms.length === 0) return true;
    const open = this.open(person);
    return rooms.every((room) => open.has(room));
  }

  /** A reader's filter: what this person may be shown. The gate is asked once, when first needed. */
  visibleTo(people: readonly OperationActor[]): (rooms: readonly string[]) => boolean {
    let open: Set<string>[] | undefined;
    return (rooms) => {
      if (rooms.length === 0) return true;
      open ??= people.map((person) => this.open(person));
      return open.every((set) => rooms.every((room) => set.has(room)));
    };
  }

  /** The rooms the agent's conversation with this person has read. */
  seen(agentId: string, userId: string): string[] {
    return this.db
      .select({ operationId: officeAgentRoomReads.operationId })
      .from(officeAgentRoomReads)
      .where(
        and(eq(officeAgentRoomReads.agentId, agentId), eq(officeAgentRoomReads.userId, userId)),
      )
      .all()
      .map((row) => row.operationId);
  }

  /** The conversation was started over: nothing of any room is in it any more. */
  forget(agentId: string, userId: string): void {
    this.db
      .delete(officeAgentRoomReads)
      .where(
        and(eq(officeAgentRoomReads.agentId, agentId), eq(officeAgentRoomReads.userId, userId)),
      )
      .run();
  }

  /** The agent read these rooms while answering this person. */
  sawRooms(agentId: string, userId: string, rooms: Iterable<string>): void {
    for (const operationId of new Set(rooms)) {
      this.db
        .insert(officeAgentRoomReads)
        .values({ agentId, userId, operationId })
        .onConflictDoNothing()
        .run();
    }
  }

  /**
   * May something scoped to `rooms` be put where everyone who can enter
   * `operationId` reads it (the lobby and corridors when it is null: everyone)?
   * Only when every one of those readers can see every room of the scope.
   */
  audienceCanSeeAll(operationId: string | null, rooms: readonly string[]): boolean {
    const about = rooms.filter((room) => room !== operationId);
    if (about.length === 0) return true;
    const people = this.db
      .select({ id: userProfiles.userId, role: userProfiles.role })
      .from(userProfiles)
      .all();
    for (const person of people) {
      const open = this.open(person);
      if (operationId !== null && !open.has(operationId)) continue;
      if (!about.every((room) => open.has(room))) return false;
    }
    return true;
  }
}
