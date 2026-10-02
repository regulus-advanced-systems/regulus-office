/**
 * Meeting rows → protocol `MeetingSummary` / `MeetingDetail` (#50).
 */
import { type AgentStatus, MeetingDetail, MeetingSummary, planMeeting } from "@regulus/protocol";
import type { MeetingRow, MeetingStore, MemberRow, TurnRow } from "./store.ts";

const ms = (d: Date | null | undefined) => (d ? d.getTime() : 0);

export function title(topic: string): string {
  const first = topic.split("\n").find((l) => l.trim()) ?? topic;
  const t = first.trim();
  return t.length > 200 ? `${t.slice(0, 199)}…` : t;
}

/** Steps whose turns are all done, and the round of the first open one. */
export function progress(row: MeetingRow, memberCount: number, turns: readonly TurnRow[]) {
  const steps = planMeeting(row.pattern, memberCount, row.rounds);
  const done = new Set(
    turns.filter((t) => t.status === "done").map((t) => `${t.step}:${t.position}`),
  );
  let step = 0;
  while (step < steps.length && steps[step]?.turns.every((t) => done.has(`${step}:${t.position}`)))
    step++;
  const round = steps[Math.min(step, steps.length - 1)]?.round ?? 0;
  return { steps, step, round: row.finishedAt ? row.rounds : round };
}

export function summaryOf(
  row: MeetingRow,
  members: readonly MemberRow[],
  turns: readonly TurnRow[],
  ctx: { starterName: string; status(agentId: string): AgentStatus | undefined },
): MeetingSummary {
  const p = progress(row, members.length, turns);
  return MeetingSummary.parse({
    id: row.id,
    operationId: row.operationId,
    repoId: row.repoId,
    pattern: row.pattern,
    title: title(row.topic),
    status: row.status,
    reason: row.reason,
    startedBy: row.startedBy,
    starterName: ctx.starterName.slice(0, 64),
    round: p.round,
    rounds: row.rounds,
    step: p.step,
    steps: p.steps.length,
    tokensUsed: row.tokensUsed,
    tokenBudget: row.tokenBudget,
    output: row.output,
    prNumber: row.prNumber ?? 0,
    branch: row.branch ?? "",
    outputUrl: row.outputUrl ?? "",
    members: members.map((m) => ({
      position: m.position,
      role: m.role,
      name: m.name,
      agentId: m.agentId ?? "",
      seatId: "",
      provider: m.provider,
      model: m.model,
      status: (m.agentId && ctx.status(m.agentId)) || (m.agentId ? "offline" : "starting"),
    })),
    speaking: turns.filter((t) => t.status === "running").map((t) => t.position),
    createdAt: ms(row.createdAt),
    updatedAt: ms(row.updatedAt),
    finishedAt: ms(row.finishedAt),
  });
}

export function detailOf(
  summary: MeetingSummary,
  row: MeetingRow,
  turns: readonly TurnRow[],
  acl: { canControl: boolean; canEmergencyStop: boolean },
): MeetingDetail {
  return MeetingDetail.parse({
    ...summary,
    topic: row.topic,
    turns: turns.map((t) => ({
      step: t.step,
      round: t.round,
      position: t.position,
      kind: t.kind,
      status: t.status,
      text: t.text,
      tokens: t.tokens,
      startedAt: ms(t.startedAt),
      finishedAt: ms(t.finishedAt),
    })),
    ...acl,
  });
}

/** Summary straight from the store. */
export function loadSummary(
  store: MeetingStore,
  row: MeetingRow,
  status: (agentId: string) => AgentStatus | undefined,
  seatOf?: (agentId: string) => string,
): MeetingSummary {
  const summary = summaryOf(row, store.members(row.id), store.turns(row.id), {
    starterName: store.displayName(row.startedBy),
    status,
  });
  if (seatOf) {
    for (const m of summary.members) if (m.agentId) m.seatId = seatOf(m.agentId);
  }
  return summary;
}
