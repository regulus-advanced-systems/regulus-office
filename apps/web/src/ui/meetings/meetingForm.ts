/**
 * The start-a-meeting form as data (#50): defaults, validation, the agenda
 * preview and the request it sends. Members are the starter's own henchmen,
 * so a credential is a profile id of theirs or an office key ("" = their own
 * CLI login), never a secret (SPEC §8).
 */
import {
  MEETING_LIMITS,
  MEETING_MEMBERS_MAX,
  MEETING_MEMBERS_MIN,
  MEETING_ROLE_LABELS,
  MEETING_TURN_LABELS,
  type MeetingOutput,
  type MeetingPattern,
  meetingRoles,
  type ProviderId,
  planMeeting,
  type StartMeetingRequest,
} from "@regulus/protocol";
import { PROVIDER_PRESETS } from "../spawn/models.ts";

export interface MemberDraft {
  provider: ProviderId;
  model: string;
  /** "" = the starter's own CLI login. */
  profileId: string;
}

export interface MeetingDraft {
  pattern: MeetingPattern;
  topic: string;
  repoId: string;
  members: MemberDraft[];
  rounds: number;
  tokenBudget: number;
  turnTimeoutMinutes: number;
  output: MeetingOutput;
  /** As typed. */
  prNumber: string;
}

export type DraftField = "topic" | "repoId" | "members" | "prNumber" | "rounds";
export type DraftErrors = Partial<Record<DraftField, string>>;

export const TOKEN_BUDGETS = [200_000, 500_000, 1_000_000, 2_000_000, 5_000_000, 10_000_000];

export const OUTPUT_LABELS: Readonly<Record<MeetingOutput, string>> = {
  pull_request: "Draft pull request",
  pr_review: "Review on a pull request",
  notes: "Notes only",
};

const preset = (provider: ProviderId) => PROVIDER_PRESETS.find((p) => p.id === provider);

export function defaultMember(provider: ProviderId = "claude-code"): MemberDraft {
  return { provider, model: preset(provider)?.defaultModel ?? "", profileId: "" };
}

export function defaultDraft(repoId: string): MeetingDraft {
  return {
    pattern: "debate",
    topic: "",
    repoId,
    members: [defaultMember("claude-code"), defaultMember("codex")],
    rounds: MEETING_LIMITS.roundsDefault,
    tokenBudget: MEETING_LIMITS.tokenBudgetDefault,
    turnTimeoutMinutes: MEETING_LIMITS.turnTimeoutMinutesDefault,
    output: "pull_request",
    prNumber: "",
  };
}

/** Outputs a pattern may end in: a review panel always reviews a PR. */
export function outputsFor(pattern: MeetingPattern): MeetingOutput[] {
  return pattern === "review_panel" ? ["pr_review"] : ["pull_request", "pr_review", "notes"];
}

/** Switch pattern, keeping the output valid. */
export function withPattern(d: MeetingDraft, pattern: MeetingPattern): MeetingDraft {
  const outputs = outputsFor(pattern);
  return { ...d, pattern, output: outputs.includes(d.output) ? d.output : (outputs[0] ?? "notes") };
}

export const needsPull = (d: Pick<MeetingDraft, "pattern" | "output">) =>
  d.pattern === "review_panel" || d.output === "pr_review";

export function draftErrors(d: MeetingDraft): DraftErrors {
  const errors: DraftErrors = {};
  if (!d.topic.trim()) errors.topic = "Say what the meeting should work on.";
  if (!d.repoId) errors.repoId = "Pick a repo.";
  if (d.members.length < MEETING_MEMBERS_MIN || d.members.length > MEETING_MEMBERS_MAX) {
    errors.members = `A meeting has ${MEETING_MEMBERS_MIN} to ${MEETING_MEMBERS_MAX} henchmen.`;
  } else if (d.members.some((m) => !m.model)) {
    errors.members = "Pick a model for every henchman.";
  }
  if (needsPull(d) && !/^[1-9]\d{0,8}$/.test(d.prNumber.trim())) {
    errors.prNumber = "The pull request's number.";
  }
  return errors;
}

export function draftRequest(operationId: string, d: MeetingDraft): StartMeetingRequest {
  return {
    operationId,
    repoId: d.repoId,
    pattern: d.pattern,
    topic: d.topic.trim(),
    members: d.members.map((m) => ({
      provider: m.provider,
      model: m.model,
      ...(m.profileId ? { profileId: m.profileId } : {}),
    })),
    rounds: d.rounds,
    tokenBudget: d.tokenBudget,
    turnTimeoutMinutes: d.turnTimeoutMinutes,
    output: d.pattern === "review_panel" ? "pr_review" : d.output,
    ...(needsPull(d) ? { prNumber: Number(d.prNumber.trim()) } : {}),
  };
}

/** Member names as the server gives them: the role, numbered when it repeats. */
export function memberLabels(pattern: MeetingPattern, count: number): string[] {
  const roles = meetingRoles(pattern, count);
  const totals = new Map<string, number>();
  for (const r of roles) totals.set(r, (totals.get(r) ?? 0) + 1);
  const seen = new Map<string, number>();
  return roles.map((r) => {
    const n = (seen.get(r) ?? 0) + 1;
    seen.set(r, n);
    return (totals.get(r) ?? 0) > 1 ? `${MEETING_ROLE_LABELS[r]} ${n}` : MEETING_ROLE_LABELS[r];
  });
}

/** The agenda, one line per round: "Round 1: Proposer opens → Challenger opens". */
export function agendaLines(pattern: MeetingPattern, count: number, rounds: number): string[] {
  const names = memberLabels(pattern, count);
  const lines = new Map<number, string[]>();
  for (const step of planMeeting(pattern, count, rounds)) {
    const what = step.turns
      .map((t) => `${names[t.position] ?? "?"} ${MEETING_TURN_LABELS[t.kind]}`)
      .join(" + ");
    lines.set(step.round, [...(lines.get(step.round) ?? []), what]);
  }
  return [...lines.entries()].map(([round, steps]) => `Round ${round}: ${steps.join(" → ")}`);
}

/** "2M", "500k". */
export function tokens(n: number): string {
  if (n >= 1_000_000) return `${+(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}
