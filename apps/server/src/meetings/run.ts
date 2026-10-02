/**
 * One meeting from start to finish (#50): convene (shared worktree, member
 * henchmen spawned by the starter), then the agenda step by step, then the
 * output. Everything it decides is in the database first, so a restarted
 * office picks the meeting up at the first unfinished step (`progress`), and a
 * turn that was running when it stopped is either read back (its notes are
 * written and the henchman rests), waited for (still busy) or asked again.
 *
 * Budgets are the server's: the agenda is bounded by the rounds, and no step
 * starts once the token budget is used up (the engine also halts a meeting
 * the moment a usage event crosses it).
 */
import { join } from "node:path";
import type { MeetingStatus, PlannedStep, PlannedTurn } from "@regulus/protocol";
import type { Logger } from "../logging.ts";
import type { OperationActor } from "../operations/access.ts";
import { closeMeeting } from "./close.ts";
import type { MeetingHenchmen, MeetingOutputs, MeetingWorkspaces } from "./ports.ts";
import { turnFile, turnPrompt } from "./prompt.ts";
import type { MeetingRow, MeetingStore, MemberRow, TurnRow } from "./store.ts";
import {
  BUSY,
  MeetingAborted,
  RESTING,
  readyVerdict,
  TurnError,
  type TurnWatch,
  turnVerdicts,
} from "./turns.ts";
import { progress, title } from "./views.ts";

export interface RunContext {
  store: MeetingStore;
  henchmen: MeetingHenchmen;
  workspaces: MeetingWorkspaces;
  outputs: MeetingOutputs;
  watch: TurnWatch;
  logger: Logger;
  publish(meetingId: string): void;
  pollMs: number;
  readyTimeoutMs: number;
  now(): number;
}

const branchSlug = (row: MeetingRow) =>
  `meeting-${title(row.topic)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40)}`.replace(/-$/, "");

/** Shared worktree and member henchmen; `starting` → `running`. */
export async function convene(
  ctx: RunContext,
  row: MeetingRow,
  starter: OperationActor,
  signal: AbortSignal,
) {
  const base =
    row.pattern === "review_panel" && row.prNumber
      ? ctx.workspaces.pullBase(row.repoId, row.prNumber)
      : undefined;
  if (base === null) {
    throw new TurnError(`pull request #${row.prNumber} has no branch in this repo to review`);
  }
  const workspace = await ctx.workspaces.prepare({
    meetingId: row.id,
    operationId: row.operationId,
    repoId: row.repoId,
    ownerUserId: row.startedBy,
    slug: branchSlug(row),
    ...(base ? { base } : {}),
  });
  ctx.store.update(row.id, { workdir: workspace.workdir, branch: workspace.branch });
  ctx.publish(row.id);
  const waiting = ctx.store.members(row.id).filter((m) => !m.agentId);
  const seats = ctx.henchmen.freeSeats(row.operationId, waiting.length);
  for (const [i, member] of waiting.entries()) {
    // Paused or stopped while convening: the rest stay unspawned (a resume spawns them).
    if (signal.aborted) throw new MeetingAborted("the meeting was interrupted");
    await ctx.henchmen.spawn(
      starter,
      {
        operationId: row.operationId,
        repoId: row.repoId,
        seatId: seats[i],
        provider: member.provider,
        model: member.model,
        effort: member.effort ?? undefined,
        permissionMode: (member.permissionMode ?? undefined) as never,
        profileId: member.profileId ?? undefined,
        prompt: "",
        taskTitle: `Meeting · ${member.name}: ${title(row.topic)}`.slice(0, 200),
        autoWorktree: true,
      },
      workspace,
      (agentId) => ctx.store.setMemberAgent(row.id, member.position, agentId),
    );
    ctx.publish(row.id);
  }
  if (signal.aborted || ctx.store.get(row.id)?.status !== "starting") return;
  ctx.store.setStatus(row.id, "running");
  ctx.publish(row.id);
}

/** The agenda from the first unfinished step; returns when the meeting is over or halted. */
export async function runAgenda(
  ctx: RunContext,
  meetingId: string,
  starter: OperationActor,
  signal: AbortSignal,
  halt: (status: MeetingStatus, reason: string) => Promise<void>,
): Promise<void> {
  for (;;) {
    if (signal.aborted) return;
    const row = ctx.store.get(meetingId);
    if (!row || row.status !== "running") return;
    const members = ctx.store.members(meetingId);
    const turns = ctx.store.turns(meetingId);
    const { steps, step } = progress(row, members.length, turns);
    const planned = steps[step];
    if (!planned) {
      await closeMeeting(ctx, row, starter);
      return;
    }
    if (row.tokensUsed >= row.tokenBudget) {
      await halt("stopped", budgetReason(row.tokensUsed, row.tokenBudget));
      return;
    }
    const prior = new Map(turns.filter((t) => t.step === step).map((t) => [t.position, t]));
    await Promise.all(
      planned.turns.map((t) =>
        prior.get(t.position)?.status === "done"
          ? undefined
          : takeTurn(ctx, { row, members, starter, signal }, planned, t, prior.get(t.position)),
      ),
    );
  }
}

export const budgetReason = (used: number, budget: number) =>
  `the token budget is used up (${used.toLocaleString("en")} of ${budget.toLocaleString("en")} tokens)`;

interface TurnScope {
  row: MeetingRow;
  members: readonly MemberRow[];
  starter: OperationActor;
  signal: AbortSignal;
}

async function takeTurn(
  ctx: RunContext,
  scope: TurnScope,
  step: PlannedStep,
  planned: PlannedTurn,
  prior: TurnRow | undefined,
): Promise<void> {
  const { row, members, starter } = scope;
  const member = members[planned.position];
  const agentId = member?.agentId;
  if (!member || !agentId) throw new TurnError("a member is missing from the meeting");
  const workdir = row.workdir ?? "";
  const file = join(workdir, turnFile(step.index, step.round, member.name));
  const read = () => ctx.henchmen.readFile(row.startedBy, file);
  const key = { meetingId: row.id, step: step.index, position: planned.position };
  const finish = (text: string) => {
    ctx.store.finishTurn(row.id, step.index, planned.position, "done", text);
    ctx.publish(row.id);
  };

  // A turn that was running when the office stopped: read back, wait, or ask again.
  let busy = false;
  const stale = await read();
  if (prior?.status === "running") {
    const status = ctx.henchmen.status(agentId);
    if (stale !== null && status && RESTING.includes(status)) return finish(stale);
    busy = status !== undefined && BUSY.includes(status);
  }
  ctx.store.startTurn({ ...key, round: step.round, kind: planned.kind });
  ctx.publish(row.id);
  const startedAt = ctx.now();

  const turnAbort = new AbortController();
  const onAbort = () => turnAbort.abort();
  scope.signal.addEventListener("abort", onAbort);
  try {
    if (!busy) await waitReady(ctx, agentId, member.name, turnAbort.signal);
    const verdicts = turnVerdicts({ busy, stale: busy ? null : stale });
    const minutes = Math.round(row.turnTimeoutMs / 60_000);
    const done = ctx.watch.until(agentId, {
      signal: turnAbort.signal,
      timeoutMs: row.turnTimeoutMs,
      pollMs: ctx.pollMs,
      timeoutMessage: `${member.name} did not finish the turn within ${minutes} minute(s)`,
      onStatus: (s) => verdicts.onStatus(s),
      poll: async () => verdicts.poll(ctx.henchmen.status(agentId), await read()),
    });
    done.catch(() => undefined);
    if (!busy) {
      const prompt = turnPrompt({
        pattern: row.pattern,
        topic: row.topic,
        rounds: row.rounds,
        round: step.round,
        step: step.index,
        kind: planned.kind,
        member,
        members,
        branch: row.branch ?? "",
        output: row.output,
        prNumber: row.prNumber,
        baseBranch: ctx.workspaces.baseBranch(row.repoId),
      });
      try {
        await ctx.henchmen.prompt(starter, agentId, prompt);
      } catch (err) {
        turnAbort.abort();
        throw new TurnError(`${member.name} did not take the prompt: ${message(err)}`);
      }
    }
    await done;
  } catch (err) {
    if (err instanceof TurnError && !err.message.startsWith(member.name)) {
      throw new TurnError(`${member.name}: ${err.message}`);
    }
    throw err;
  } finally {
    scope.signal.removeEventListener("abort", onAbort);
  }
  const notes = (await read()) ?? ctx.henchmen.lastMessage(agentId, startedAt);
  finish(notes ?? "(no notes were written for this turn)");
}

async function waitReady(ctx: RunContext, agentId: string, name: string, signal: AbortSignal) {
  if (readyVerdict(ctx.henchmen.status(agentId)) === "resolve") return;
  await ctx.watch.until(agentId, {
    signal,
    timeoutMs: ctx.readyTimeoutMs,
    pollMs: ctx.pollMs,
    timeoutMessage: `${name} did not get ready in time`,
    onStatus: (s) => readyVerdict(s),
    poll: () => readyVerdict(ctx.henchmen.status(agentId)),
  });
}

export function message(err: unknown): string {
  return err instanceof Error ? err.message.slice(0, 300) : "unknown error";
}
