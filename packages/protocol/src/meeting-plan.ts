/**
 * Meeting patterns (#50, SPEC §10 M3, D9): who takes part in what role and in
 * which order the henchmen speak. A meeting's whole agenda follows from its
 * pattern, its member count and its round budget, so the server runs it step
 * by step, resumes it at the first unfinished step after a restart, and the
 * client shows the same agenda. The turns of one step run at the same time;
 * steps run one after the other.
 *
 * No zod here, so the web bundle can import it on its own.
 */

export const MEETING_PATTERNS = [
  "debate",
  "lead_team",
  "map_reduce",
  "red_blue",
  "review_panel",
] as const;
export type MeetingPattern = (typeof MEETING_PATTERNS)[number];

export const MEETING_ROLES = [
  "proposer",
  "challenger",
  "debater",
  "judge",
  "lead",
  "engineer",
  "reducer",
  "mapper",
  "blue",
  "red",
  "chair",
  "reviewer",
] as const;
export type MeetingRole = (typeof MEETING_ROLES)[number];

/** What a turn asks of its henchman (the server words the instruction). */
export const MEETING_TURN_KINDS = [
  "plan",
  "open",
  "rebut",
  "work",
  "review",
  "discuss",
  "map",
  "reduce",
  "build",
  "attack",
  "fix",
  "final",
] as const;
export type MeetingTurnKind = (typeof MEETING_TURN_KINDS)[number];

export const MEETING_MEMBERS_MIN = 2;
export const MEETING_MEMBERS_MAX = 5;
export const MEETING_ROUNDS_MIN = 1;
export const MEETING_ROUNDS_MAX = 10;

export interface PlannedTurn {
  /** Index into the meeting's members (0-based, the order they were picked in). */
  readonly position: number;
  readonly kind: MeetingTurnKind;
}

export interface PlannedStep {
  /** 0-based, the step's place in the agenda. */
  readonly index: number;
  /** 1-based round the step belongs to (the closing step counts in the last round). */
  readonly round: number;
  /** Turns taken at the same time. */
  readonly turns: readonly PlannedTurn[];
}

export const MEETING_PATTERN_LABELS: Readonly<Record<MeetingPattern, string>> = {
  debate: "Debate",
  lead_team: "Lead & team",
  map_reduce: "Map-reduce",
  red_blue: "Red / blue",
  review_panel: "Review panel",
};

export const MEETING_PATTERN_BLURBS: Readonly<Record<MeetingPattern, string>> = {
  debate: "Two or more henchmen argue in turns; the judge (or the proposer) decides and acts.",
  lead_team:
    "The lead plans and splits the work, the team builds it in turns, the lead integrates.",
  map_reduce:
    "The reducer splits the task, mappers work on their slices at once, the reducer merges.",
  red_blue: "Blue builds, red attacks it, blue fixes what red found, round after round.",
  review_panel:
    "Everyone reviews a pull request at once, they discuss, the chair posts one review.",
};

export const MEETING_ROLE_LABELS: Readonly<Record<MeetingRole, string>> = {
  proposer: "Proposer",
  challenger: "Challenger",
  debater: "Debater",
  judge: "Judge",
  lead: "Lead",
  engineer: "Engineer",
  reducer: "Reducer",
  mapper: "Mapper",
  blue: "Blue",
  red: "Red",
  chair: "Chair",
  reviewer: "Reviewer",
};

export const MEETING_TURN_LABELS: Readonly<Record<MeetingTurnKind, string>> = {
  plan: "plans",
  open: "opens",
  rebut: "rebuts",
  work: "works",
  review: "reviews",
  discuss: "discusses",
  map: "maps",
  reduce: "reduces",
  build: "builds",
  attack: "attacks",
  fix: "fixes",
  final: "closes",
};

/** Roles of a meeting's members, by position. */
export function meetingRoles(pattern: MeetingPattern, count: number): MeetingRole[] {
  const n = Math.max(0, Math.floor(count));
  const fill = (first: MeetingRole, rest: MeetingRole): MeetingRole[] =>
    Array.from({ length: n }, (_, i) => (i === 0 ? first : rest));
  switch (pattern) {
    case "debate":
      if (n <= 2) return (["proposer", "challenger"] as MeetingRole[]).slice(0, n);
      return Array.from({ length: n }, (_, i) =>
        i === 0 ? "proposer" : i === n - 1 ? "judge" : i === 1 ? "challenger" : "debater",
      );
    case "lead_team":
      return fill("lead", "engineer");
    case "map_reduce":
      return fill("reducer", "mapper");
    case "red_blue":
      return Array.from({ length: n }, (_, i) => (i % 2 === 0 ? "blue" : "red"));
    case "review_panel":
      return fill("chair", "reviewer");
  }
}

/** The member who takes the closing turn and whose turn produces the output. */
export function meetingCloser(pattern: MeetingPattern, count: number): number {
  return pattern === "debate" && count >= 3 ? count - 1 : 0;
}

const range = (n: number) => Array.from({ length: n }, (_, i) => i);

/** The whole agenda: steps in order, each a set of turns taken at the same time. */
export function planMeeting(
  pattern: MeetingPattern,
  memberCount: number,
  rounds: number,
): PlannedStep[] {
  const n = Math.min(MEETING_MEMBERS_MAX, Math.max(MEETING_MEMBERS_MIN, Math.floor(memberCount)));
  const r = Math.min(MEETING_ROUNDS_MAX, Math.max(MEETING_ROUNDS_MIN, Math.floor(rounds)));
  const roles = meetingRoles(pattern, n);
  const closer = meetingCloser(pattern, n);
  const steps: { round: number; turns: PlannedTurn[] }[] = [];
  const step = (round: number, ...turns: PlannedTurn[]) => steps.push({ round, turns });
  const others = range(n).filter((p) => p !== 0);

  switch (pattern) {
    case "debate": {
      const speakers = range(n).filter((p) => roles[p] !== "judge");
      for (let round = 1; round <= r; round++) {
        for (const p of speakers)
          step(round, { position: p, kind: round === 1 ? "open" : "rebut" });
      }
      step(r, { position: closer, kind: "final" });
      break;
    }
    case "lead_team":
      step(1, { position: 0, kind: "plan" });
      for (let round = 1; round <= r; round++) {
        for (const p of others) step(round, { position: p, kind: "work" });
        step(round, { position: 0, kind: round === r ? "final" : "review" });
      }
      break;
    case "map_reduce":
      step(1, { position: 0, kind: "plan" });
      for (let round = 1; round <= r; round++) {
        step(round, ...others.map((p) => ({ position: p, kind: "map" as const })));
        step(round, { position: 0, kind: round === r ? "final" : "reduce" });
      }
      break;
    case "red_blue": {
      const blue = range(n).filter((p) => roles[p] === "blue");
      const red = range(n).filter((p) => roles[p] === "red");
      for (let round = 1; round <= r; round++) {
        for (const p of blue) step(round, { position: p, kind: round === 1 ? "build" : "fix" });
        for (const p of red) step(round, { position: p, kind: "attack" });
      }
      step(r, { position: closer, kind: "final" });
      break;
    }
    case "review_panel":
      for (let round = 1; round <= r; round++) {
        step(
          round,
          ...range(n).map(
            (p) => ({ position: p, kind: round === 1 ? "review" : "discuss" }) as const,
          ),
        );
      }
      step(r, { position: closer, kind: "final" });
      break;
  }
  return steps.map((s, index) => ({ index, round: s.round, turns: s.turns }));
}

/** Turns in the whole agenda (the hard cap the server enforces). */
export function plannedTurnCount(steps: readonly PlannedStep[]): number {
  return steps.reduce((sum, s) => sum + s.turns.length, 0);
}
