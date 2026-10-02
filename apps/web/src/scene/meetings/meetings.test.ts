import { describe, expect, test } from "bun:test";
import type { MeetingSummary } from "@regulus/protocol";
import { generateRoom } from "@regulus/room-layout";
import { meetingAnchor } from "./meetingAnchor.ts";
import { boardText, doorLines } from "./meetingSignTexture.ts";

const room = generateRoom({
  width: 8,
  depth: 8,
  doorSide: "south",
  deskCount: 2,
  decorStyle: "ops_room",
});

describe("meeting anchor (#50)", () => {
  test("members of one pod: over that pod's table", () => {
    const desk = room.room.desks[0];
    if (!desk) throw new Error("no desk");
    const a = meetingAnchor(room, desk.seatIds.slice(0, 3));
    const table = room.obstacles.find((o) => o.id === desk.tableId);
    expect(table).toBeDefined();
    expect(a?.x).toBeCloseTo((table?.rect.x ?? 0) + (table?.rect.w ?? 0) / 2);
    expect(a?.z).toBeCloseTo((table?.rect.z ?? 0) + (table?.rect.d ?? 0) / 2);
    expect(a?.seats.size).toBe(3);
  });

  test("members over two pods: the middle of their seats; unknown seats: nothing", () => {
    const [d1, d2] = room.room.desks;
    const ids = [d1?.seatIds[0] ?? "", d2?.seatIds[0] ?? ""];
    const a = meetingAnchor(room, ids);
    const seats = ids.map((id) => room.seats.find((s) => s.id === id)?.pose);
    expect(a?.x).toBeCloseTo(((seats[0]?.x ?? 0) + (seats[1]?.x ?? 0)) / 2);
    expect(meetingAnchor(room, ["nope"])).toBeNull();
  });
});

const meeting = (over: Partial<MeetingSummary>): MeetingSummary => ({
  id: "m",
  operationId: "o",
  repoId: "r",
  pattern: "review_panel",
  title: "t",
  status: "running",
  reason: "",
  startedBy: "u",
  starterName: "U",
  round: 2,
  rounds: 3,
  step: 1,
  steps: 4,
  tokensUsed: 900,
  tokenBudget: 1000,
  output: "pr_review",
  prNumber: 7,
  branch: "b",
  outputUrl: "",
  members: ["Chair", "Reviewer 1", "Reviewer 2"].map((name, position) => ({
    position,
    role: position === 0 ? "chair" : "reviewer",
    name,
    agentId: `a${position}`,
    seatId: `d1s${position + 1}`,
    provider: "codex",
    model: "m",
    status: "working",
  })),
  speaking: [1],
  createdAt: 0,
  updatedAt: 0,
  finishedAt: 0,
  ...over,
});

describe("hologram and door sign text (#50)", () => {
  test("who has the floor, the round and the budget", () => {
    expect(boardText(meeting({}))).toEqual({
      pattern: "REVIEW PANEL",
      round: "ROUND 2/3",
      floor: "REVIEWER 1 HAS THE FLOOR",
      status: "running",
      budget: 0.9,
    });
    expect(boardText(meeting({ speaking: [0, 1, 2] })).floor).toBe("3 SPEAKING AT ONCE");
    expect(boardText(meeting({ status: "paused" })).floor).toBe("PAUSED");
    expect(boardText(meeting({ status: "starting", round: 0 })).round).toBe("ROUND 1/3");
  });

  test("the door says whether the meeting is on or paused", () => {
    expect(doorLines(meeting({}))).toEqual({
      title: "MEETING IN SESSION",
      detail: "REVIEW PANEL · ROUND 2/3",
    });
    expect(doorLines(meeting({ status: "paused" })).title).toBe("MEETING PAUSED");
  });
});
