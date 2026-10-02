import { describe, expect, test } from "bun:test";
import { StartMeetingRequest } from "@regulus/protocol";
import {
  agendaLines,
  defaultDraft,
  draftErrors,
  draftRequest,
  memberLabels,
  outputsFor,
  tokens,
  withPattern,
} from "./meetingForm.ts";

describe("meeting form (#50)", () => {
  test("defaults: a debate of Claude and Codex, two rounds, a draft PR", () => {
    const d = defaultDraft("r1");
    expect(d.members.map((m) => m.provider)).toEqual(["claude-code", "codex"]);
    expect(d.rounds).toBe(2);
    expect(d.output).toBe("pull_request");
    expect(draftErrors(d)).toEqual({ topic: "Say what the meeting should work on." });
  });

  test("a review panel posts a review and needs the PR number", () => {
    const d = withPattern({ ...defaultDraft("r1"), topic: "Review it" }, "review_panel");
    expect(d.output).toBe("pr_review");
    expect(outputsFor("review_panel")).toEqual(["pr_review"]);
    expect(draftErrors(d).prNumber).toBeDefined();
    const ok = { ...d, prNumber: " 42 " };
    expect(draftErrors(ok)).toEqual({});
    const req = draftRequest("op", ok);
    expect(req).toMatchObject({ pattern: "review_panel", output: "pr_review", prNumber: 42 });
    expect(StartMeetingRequest.safeParse(req).success).toBe(true);
  });

  test("the request carries profile ids only when one was picked (own login = none)", () => {
    const d = { ...defaultDraft("r1"), topic: "  Pick a cache  " };
    d.members[1] = { ...d.members[1], profileId: "office:codex" } as (typeof d.members)[number];
    const req = draftRequest("op", d);
    expect(req.topic).toBe("Pick a cache");
    expect(req.members[0]).toEqual({ provider: "claude-code", model: "opus" });
    expect(req.members[1]?.profileId).toBe("office:codex");
    expect(req.prNumber).toBeUndefined();
    expect(StartMeetingRequest.safeParse(req).success).toBe(true);
  });

  test("names and agenda follow the pattern", () => {
    expect(memberLabels("map_reduce", 3)).toEqual(["Reducer", "Mapper 1", "Mapper 2"]);
    expect(agendaLines("debate", 3, 2)).toEqual([
      "Round 1: Proposer opens → Challenger opens",
      "Round 2: Proposer rebuts → Challenger rebuts → Judge closes",
    ]);
    expect(agendaLines("review_panel", 2, 1)).toEqual([
      "Round 1: Chair reviews + Reviewer reviews → Chair closes",
    ]);
  });

  test("token amounts read short", () => {
    expect(tokens(2_000_000)).toBe("2M");
    expect(tokens(1_500_000)).toBe("1.5M");
    expect(tokens(500_000)).toBe("500k");
    expect(tokens(12)).toBe("12");
  });
});
