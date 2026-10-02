/**
 * `meetings`, `meeting_members` and `meeting_turns` (#50): rows in, rows out.
 * The turns are both the transcript and the cursor a restart resumes from
 * (the first agenda step with a turn that is not `done`).
 */
import {
  MEETING_LIMITS,
  type MeetingRole,
  type MeetingStatus,
  type MeetingTurnKind,
  type MeetingTurnStatus,
  type StartMeetingInput,
} from "@regulus/protocol";
import { and, asc, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { meetingMembers, meetings, meetingTurns, userProfiles } from "../db/schema/index.ts";

export type MeetingRow = typeof meetings.$inferSelect;
export type MemberRow = typeof meetingMembers.$inferSelect;
export type TurnRow = typeof meetingTurns.$inferSelect;

export interface NewMeeting {
  id: string;
  input: StartMeetingInput;
  startedBy: string;
  members: { role: MeetingRole; name: string }[];
}

/** The turn's notes as kept: capped, with a marker when cut. */
export function capTurnText(text: string): string {
  const max = MEETING_LIMITS.turnTextMax;
  return text.length > max ? `${text.slice(0, max)}\n\n… (cut at ${max} characters)` : text;
}

export class MeetingStore {
  constructor(
    readonly db: Db,
    private readonly now: () => number = Date.now,
  ) {}

  create(m: NewMeeting): void {
    const { input } = m;
    this.db.transaction((tx) => {
      tx.insert(meetings)
        .values({
          id: m.id,
          operationId: input.operationId,
          repoId: input.repoId,
          startedBy: m.startedBy,
          pattern: input.pattern,
          topic: input.topic,
          status: "starting",
          rounds: input.rounds,
          tokenBudget: input.tokenBudget,
          turnTimeoutMs: input.turnTimeoutMinutes * 60_000,
          output: input.output,
          prNumber: input.prNumber ?? null,
        })
        .run();
      input.members.forEach((member, position) => {
        const named = m.members[position];
        if (!named) throw new Error("member names do not match the members");
        tx.insert(meetingMembers)
          .values({
            meetingId: m.id,
            position,
            role: named.role,
            name: named.name,
            provider: member.provider,
            model: member.model,
            effort: member.effort ?? null,
            permissionMode: member.permissionMode ?? null,
            profileId: member.profileId ?? null,
          })
          .run();
      });
    });
  }

  get(id: string): MeetingRow | undefined {
    return this.db.select().from(meetings).where(eq(meetings.id, id)).get();
  }

  /** Live meetings first, then the latest finished ones (capped). */
  listForOperation(operationId: string): MeetingRow[] {
    const rows = this.db
      .select()
      .from(meetings)
      .where(eq(meetings.operationId, operationId))
      .orderBy(desc(meetings.createdAt))
      .all();
    const live = rows.filter((r) => !r.finishedAt);
    const finished = rows.filter((r) => r.finishedAt).slice(0, MEETING_LIMITS.historyLimit);
    return [...live, ...finished];
  }

  withStatus(statuses: readonly MeetingStatus[]): MeetingRow[] {
    if (statuses.length === 0) return [];
    return this.db
      .select()
      .from(meetings)
      .where(inArray(meetings.status, [...statuses]))
      .orderBy(asc(meetings.createdAt))
      .all();
  }

  /** Finished meetings whose shared worktree has not been removed yet. */
  finishedWithWorktree(): MeetingRow[] {
    return this.db
      .select()
      .from(meetings)
      .where(and(isNotNull(meetings.finishedAt), isNotNull(meetings.workdir)))
      .all();
  }

  update(id: string, patch: Partial<typeof meetings.$inferInsert>): void {
    this.db.update(meetings).set(patch).where(eq(meetings.id, id)).run();
  }

  setStatus(id: string, status: MeetingStatus, reason = ""): void {
    const finished = status === "done" || status === "stopped" || status === "failed";
    this.update(id, {
      status,
      reason: reason.slice(0, 500),
      ...(finished ? { finishedAt: new Date(this.now()) } : {}),
    });
  }

  /** Add tokens to the meeting (and to its running turns); returns the new total. */
  addTokens(id: string, tokens: number, positions: readonly number[]): number {
    if (tokens <= 0) return this.get(id)?.tokensUsed ?? 0;
    return this.db.transaction((tx) => {
      tx.update(meetings)
        .set({ tokensUsed: sql`${meetings.tokensUsed} + ${tokens}` })
        .where(eq(meetings.id, id))
        .run();
      if (positions.length > 0) {
        tx.update(meetingTurns)
          .set({ tokens: sql`${meetingTurns.tokens} + ${tokens}` })
          .where(
            and(
              eq(meetingTurns.meetingId, id),
              eq(meetingTurns.status, "running"),
              inArray(meetingTurns.position, [...positions]),
            ),
          )
          .run();
      }
      return (
        tx.select({ used: meetings.tokensUsed }).from(meetings).where(eq(meetings.id, id)).get()
          ?.used ?? 0
      );
    });
  }

  members(meetingId: string): MemberRow[] {
    return this.db
      .select()
      .from(meetingMembers)
      .where(eq(meetingMembers.meetingId, meetingId))
      .orderBy(asc(meetingMembers.position))
      .all();
  }

  setMemberAgent(meetingId: string, position: number, agentId: string | null): void {
    this.db
      .update(meetingMembers)
      .set({ agentId })
      .where(and(eq(meetingMembers.meetingId, meetingId), eq(meetingMembers.position, position)))
      .run();
  }

  /** The live meeting a henchman is a member of, with its position. */
  meetingOfAgent(agentId: string): { meeting: MeetingRow; position: number } | undefined {
    const row = this.db
      .select({ meeting: meetings, position: meetingMembers.position })
      .from(meetingMembers)
      .innerJoin(meetings, eq(meetings.id, meetingMembers.meetingId))
      .where(
        and(
          eq(meetingMembers.agentId, agentId),
          inArray(meetings.status, ["starting", "running", "paused"]),
        ),
      )
      .get();
    return row ?? undefined;
  }

  turns(meetingId: string): TurnRow[] {
    return this.db
      .select()
      .from(meetingTurns)
      .where(eq(meetingTurns.meetingId, meetingId))
      .orderBy(asc(meetingTurns.step), asc(meetingTurns.position))
      .all();
  }

  /** Start (or restart) a turn: `running`, notes cleared. */
  startTurn(t: {
    meetingId: string;
    step: number;
    round: number;
    position: number;
    kind: MeetingTurnKind;
  }): void {
    const now = new Date(this.now());
    this.db
      .insert(meetingTurns)
      .values({ ...t, status: "running", startedAt: now })
      .onConflictDoUpdate({
        target: [meetingTurns.meetingId, meetingTurns.step, meetingTurns.position],
        set: { status: "running", text: "", startedAt: now, finishedAt: null },
      })
      .run();
  }

  finishTurn(
    meetingId: string,
    step: number,
    position: number,
    status: Exclude<MeetingTurnStatus, "running">,
    text: string,
  ): void {
    this.db
      .update(meetingTurns)
      .set({ status, text: capTurnText(text), finishedAt: new Date(this.now()) })
      .where(
        and(
          eq(meetingTurns.meetingId, meetingId),
          eq(meetingTurns.step, step),
          eq(meetingTurns.position, position),
        ),
      )
      .run();
  }

  displayName(userId: string): string {
    const row = this.db
      .select({ name: userProfiles.displayName })
      .from(userProfiles)
      .where(eq(userProfiles.userId, userId))
      .get();
    return row?.name ?? "";
  }
}
