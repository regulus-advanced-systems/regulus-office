/**
 * The end of a meeting (#50): the closing turn's work becomes the output (a
 * draft PR of the meeting branch through the one-click PR path, a comment
 * review on the PR, or just the notes), then the meeting adjourns: members go
 * home and the shared worktree is removed, the branch kept. A worktree with
 * uncommitted changes is never removed under anyone: the henchmen stay at
 * their desks with it until the starter sends them home (then the sweep
 * removes it).
 */
import { join } from "node:path";
import { MEETING_PATTERN_LABELS, MEETING_ROLE_LABELS, meetingCloser } from "@regulus/protocol";
import type { OperationActor } from "../operations/access.ts";
import { REVIEW_FILE } from "./prompt.ts";
import type { RunContext } from "./run.ts";
import type { MeetingRow, MemberRow } from "./store.ts";
import { title } from "./views.ts";

const BODY_MAX = 60_000;

function participants(members: readonly MemberRow[]): string {
  return members
    .map((m) => `- ${m.name} (${MEETING_ROLE_LABELS[m.role]}): ${m.provider} / ${m.model}`)
    .join("\n");
}

export function pullRequestBody(row: MeetingRow, members: readonly MemberRow[], notes: string) {
  const body = [
    notes.trim() || "_The closing turn left no notes._",
    "---",
    `Opened by a Regulus Office meeting (${MEETING_PATTERN_LABELS[row.pattern]}, ${row.rounds} round(s), ${row.tokensUsed.toLocaleString("en")} tokens).`,
    participants(members),
    `Task:\n\n> ${title(row.topic)}`,
  ].join("\n\n");
  return body.length > BODY_MAX ? `${body.slice(0, BODY_MAX - 1)}…` : body;
}

export function reviewBody(row: MeetingRow, members: readonly MemberRow[], review: string) {
  const body = [
    review.trim() || "_The panel left no review text._",
    "---",
    `Review panel of a Regulus Office meeting (${MEETING_PATTERN_LABELS[row.pattern]}):\n\n${participants(members)}`,
  ].join("\n\n");
  return body.length > BODY_MAX ? `${body.slice(0, BODY_MAX - 1)}…` : body;
}

/** Produce the output, mark the meeting done, adjourn. */
export async function closeMeeting(ctx: RunContext, row: MeetingRow, starter: OperationActor) {
  const members = ctx.store.members(row.id);
  const turns = ctx.store.turns(row.id);
  const closer = members[meetingCloser(row.pattern, members.length)];
  const notes = turns.find((t) => t.kind === "final")?.text ?? "";
  let reason = "";
  try {
    if (row.output === "pull_request") {
      if (!closer?.agentId) throw new Error("the closing member is missing");
      try {
        const pr = await ctx.outputs.openPullRequest(starter, closer.agentId, {
          title: `Meeting: ${title(row.topic)}`.slice(0, 200),
          body: pullRequestBody(row, members, notes),
        });
        ctx.store.update(row.id, { outputUrl: pr.url });
        reason = `opened draft pull request #${pr.number}`;
      } catch (err) {
        if (!/no commits/i.test(err instanceof Error ? err.message : "")) throw err;
        reason = "nothing was committed, so no pull request was opened; the notes are kept";
      }
    } else if (row.output === "pr_review" && row.prNumber) {
      const file = row.workdir ? join(row.workdir, REVIEW_FILE) : "";
      const review = (file && (await ctx.henchmen.readFile(row.startedBy, file))) || notes;
      const posted = await ctx.outputs.postReview(
        row.repoId,
        row.prNumber,
        reviewBody(row, members, review),
      );
      ctx.store.update(row.id, { outputUrl: posted.url });
      reason = `posted a review on pull request #${row.prNumber}`;
    } else {
      reason = "the notes are kept in the office";
    }
  } catch (err) {
    const why = err instanceof Error ? err.message.slice(0, 300) : "unknown error";
    ctx.logger.warn({ meetingId: row.id, err: why }, "meeting output failed");
    ctx.store.setStatus(
      row.id,
      "failed",
      `the output failed: ${why}; the henchmen stay at their desks with the meeting worktree`,
    );
    ctx.publish(row.id);
    return;
  }
  ctx.store.setStatus(row.id, "done", reason);
  ctx.publish(row.id);
  await adjourn(ctx, row.id, starter);
}

/** Members home and worktree removed, unless it holds uncommitted work. */
export async function adjourn(ctx: RunContext, meetingId: string, starter: OperationActor) {
  const row = ctx.store.get(meetingId);
  if (!row?.workdir) return;
  const where = { ownerUserId: row.startedBy, repoId: row.repoId, workdir: row.workdir };
  let dirty: string[];
  try {
    dirty = await ctx.workspaces.uncommitted(where);
  } catch (err) {
    ctx.logger.warn({ meetingId, err: String(err) }, "meeting worktree status failed");
    dirty = ["?"];
  }
  if (dirty.length > 0) {
    ctx.store.update(meetingId, {
      reason:
        `${row.reason}; uncommitted changes stay in the meeting worktree with the henchmen`.slice(
          0,
          500,
        ),
    });
    ctx.publish(meetingId);
    return;
  }
  for (const m of ctx.store.members(meetingId)) {
    if (!m.agentId || ctx.henchmen.seatOf(m.agentId) === null) continue;
    try {
      await ctx.henchmen.sendHome(starter, m.agentId);
    } catch (err) {
      ctx.logger.warn({ meetingId, agentId: m.agentId, err: String(err) }, "sending home failed");
    }
  }
  await releaseIfEmpty(ctx, meetingId);
}

/** Remove a finished meeting's worktree once none of its henchmen is at a desk. */
export async function releaseIfEmpty(ctx: RunContext, meetingId: string): Promise<boolean> {
  const row = ctx.store.get(meetingId);
  if (!row?.workdir || !row.finishedAt) return false;
  const seated = ctx.store
    .members(meetingId)
    .some((m) => m.agentId && ctx.henchmen.seatOf(m.agentId) !== null);
  if (seated) return false;
  try {
    await ctx.workspaces.release({
      ownerUserId: row.startedBy,
      repoId: row.repoId,
      workdir: row.workdir,
    });
  } catch (err) {
    ctx.logger.warn({ meetingId, err: String(err) }, "meeting worktree removal failed");
    return false;
  }
  ctx.store.update(meetingId, { workdir: null });
  ctx.publish(meetingId);
  return true;
}
