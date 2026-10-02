import { describe, expect, test } from "bun:test";
import {
  MEETING_MEMBERS_MAX,
  MEETING_MEMBERS_MIN,
  MEETING_PATTERNS,
  meetingCloser,
  meetingRoles,
  planMeeting,
  plannedTurnCount,
} from "./meeting-plan.ts";
import { StartMeetingRequest } from "./meetings-api.ts";

/** `round:position.kind`, parallel turns joined with `+`. */
const agenda = (...args: Parameters<typeof planMeeting>) =>
  planMeeting(...args).map(
    (s) => `${s.round}:${s.turns.map((t) => `${t.position}.${t.kind}`).join("+")}`,
  );

describe("meeting roles", () => {
  test("debate: a judge from three members on, the proposer closes a pair", () => {
    expect(meetingRoles("debate", 2)).toEqual(["proposer", "challenger"]);
    expect(meetingRoles("debate", 4)).toEqual(["proposer", "challenger", "debater", "judge"]);
    expect(meetingCloser("debate", 2)).toBe(0);
    expect(meetingCloser("debate", 4)).toBe(3);
  });

  test("red/blue alternates, starting blue; the others have one leader", () => {
    expect(meetingRoles("red_blue", 5)).toEqual(["blue", "red", "blue", "red", "blue"]);
    expect(meetingRoles("lead_team", 3)).toEqual(["lead", "engineer", "engineer"]);
    expect(meetingRoles("map_reduce", 3)).toEqual(["reducer", "mapper", "mapper"]);
    expect(meetingRoles("review_panel", 2)).toEqual(["chair", "reviewer"]);
  });
});

describe("meeting agenda (turn order)", () => {
  test("debate: debaters in order each round, then the judge's verdict", () => {
    expect(agenda("debate", 3, 2)).toEqual([
      "1:0.open",
      "1:1.open",
      "2:0.rebut",
      "2:1.rebut",
      "2:2.final",
    ]);
    expect(agenda("debate", 2, 1)).toEqual(["1:0.open", "1:1.open", "1:0.final"]);
  });

  test("lead & team: plan, engineers one by one, lead reviews, lead closes", () => {
    expect(agenda("lead_team", 3, 2)).toEqual([
      "1:0.plan",
      "1:1.work",
      "1:2.work",
      "1:0.review",
      "2:1.work",
      "2:2.work",
      "2:0.final",
    ]);
  });

  test("map-reduce: mappers at once, then the reducer", () => {
    expect(agenda("map_reduce", 4, 2)).toEqual([
      "1:0.plan",
      "1:1.map+2.map+3.map",
      "1:0.reduce",
      "2:1.map+2.map+3.map",
      "2:0.final",
    ]);
  });

  test("red/blue: blue builds, red attacks, blue fixes, blue closes", () => {
    expect(agenda("red_blue", 3, 2)).toEqual([
      "1:0.build",
      "1:2.build",
      "1:1.attack",
      "2:0.fix",
      "2:2.fix",
      "2:1.attack",
      "2:0.final",
    ]);
  });

  test("review panel: everyone reviews at once, discusses, the chair closes", () => {
    expect(agenda("review_panel", 3, 2)).toEqual([
      "1:0.review+1.review+2.review",
      "2:0.discuss+1.discuss+2.discuss",
      "2:0.final",
    ]);
  });

  test("every pattern: exactly one closing turn, last, and every member has a turn", () => {
    for (const pattern of MEETING_PATTERNS) {
      for (let n = MEETING_MEMBERS_MIN; n <= MEETING_MEMBERS_MAX; n++) {
        const steps = planMeeting(pattern, n, 3);
        const finals = steps.flatMap((s) => s.turns).filter((t) => t.kind === "final");
        expect(finals).toHaveLength(1);
        expect(steps.at(-1)?.turns).toEqual([
          { position: meetingCloser(pattern, n), kind: "final" },
        ]);
        const speakers = new Set(steps.flatMap((s) => s.turns.map((t) => t.position)));
        expect(speakers.size).toBe(n);
        expect(steps.map((s) => s.index)).toEqual(steps.map((_, i) => i));
        expect(Math.max(...steps.map((s) => s.round))).toBe(3);
      }
    }
  });

  test("rounds bound the agenda (out-of-range input is clamped)", () => {
    expect(plannedTurnCount(planMeeting("debate", 2, 99))).toBe(
      plannedTurnCount(planMeeting("debate", 2, 10)),
    );
    expect(plannedTurnCount(planMeeting("review_panel", 5, 10))).toBe(51);
  });
});

describe("StartMeetingRequest", () => {
  const base = {
    operationId: "op",
    repoId: "repo",
    pattern: "debate",
    topic: "Pick a cache",
    members: [
      { provider: "claude-code", model: "opus" },
      { provider: "codex", model: "gpt-5" },
    ],
  };

  test("defaults: two rounds, the default token budget, a draft PR", () => {
    const parsed = StartMeetingRequest.parse(base);
    expect(parsed.rounds).toBe(2);
    expect(parsed.output).toBe("pull_request");
    expect(parsed.tokenBudget).toBe(2_000_000);
  });

  test("2 to 5 members; a review panel posts a review and names the PR", () => {
    expect(
      StartMeetingRequest.safeParse({ ...base, members: base.members.slice(0, 1) }).success,
    ).toBe(false);
    expect(
      StartMeetingRequest.safeParse({ ...base, members: Array(6).fill(base.members[0]) }).success,
    ).toBe(false);
    expect(StartMeetingRequest.safeParse({ ...base, pattern: "review_panel" }).success).toBe(false);
    expect(
      StartMeetingRequest.safeParse({ ...base, pattern: "review_panel", output: "pr_review" })
        .success,
    ).toBe(false);
    expect(
      StartMeetingRequest.safeParse({
        ...base,
        pattern: "review_panel",
        output: "pr_review",
        prNumber: 7,
      }).success,
    ).toBe(true);
  });

  test("budgets are bounded", () => {
    expect(StartMeetingRequest.safeParse({ ...base, rounds: 11 }).success).toBe(false);
    expect(StartMeetingRequest.safeParse({ ...base, tokenBudget: 100 }).success).toBe(false);
  });
});
