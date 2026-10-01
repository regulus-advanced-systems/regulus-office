/** Carry-a-card rules (#36) on the FloorRoom state, without a transport. */
import { describe, expect, test } from "bun:test";
import {
  COMMAND_REJECTED_MESSAGE,
  type CommandRejected,
  DeskStateSchema,
  type FloorAccess,
  FloorStateSchema,
  IssueCardSchema,
  PullCardSchema,
} from "@regulus/protocol";
import type { RoomClient } from "../transport.ts";
import { type CardCommand, dropCarriedOnLeave, handleCardCommand } from "./cards.ts";
import type { FloorRoomState } from "./state.ts";

function floor(): FloorRoomState {
  const state = new FloorStateSchema();
  const issue = new IssueCardSchema();
  issue.repoId = "r1";
  issue.number = 7;
  state.issues.set("r1#7", issue);
  const pull = new PullCardSchema();
  pull.repoId = "r1";
  pull.number = 9;
  state.pulls.set("r1#9", pull);
  for (const [seatId, agentId] of [
    ["desk-1", ""],
    ["desk-2", "agent-x"],
  ]) {
    const desk = new DeskStateSchema();
    desk.seatId = seatId as string;
    desk.agentId = agentId as string;
    state.desks.set(seatId as string, desk);
  }
  return state;
}

function client(sessionId: string, userId: string) {
  const rejected: string[] = [];
  const c: RoomClient = {
    sessionId,
    user: { userId, displayName: userId, role: "member" } as RoomClient["user"],
    send: (type, payload) => {
      if (type === COMMAND_REJECTED_MESSAGE) rejected.push((payload as CommandRejected).reason);
    },
    leave: () => {},
  };
  return { c, rejected };
}

const pick = (cardKind: "issue" | "pr", number: number): CardCommand => ({
  type: "card.pick",
  cardKind,
  repoId: "r1",
  number,
});
const drop = (seatId?: string): CardCommand =>
  seatId ? { type: "card.drop", seatId } : { type: "card.drop" };

function run(state: FloorRoomState, who: RoomClient, access: FloorAccess | null, cmd: CardCommand) {
  handleCardCommand({ state, client: who, access, now: () => 42 }, cmd);
}

describe("card.pick", () => {
  test("a spawner or manager plucks a card on this board; everyone sees it", () => {
    const state = floor();
    const { c, rejected } = client("s1", "u-ada");
    run(state, c, "spawn", pick("issue", 7));
    expect(rejected).toEqual([]);
    expect(state.carriedCards.get("s1")?.toJSON()).toEqual({
      sessionId: "s1",
      userId: "u-ada",
      cardKind: "issue",
      repoId: "r1",
      number: 7,
      pickedAt: 42,
    });
    // A new pick replaces the card in hand.
    run(state, c, "manage", pick("pr", 9));
    expect(state.carriedCards.size).toBe(1);
    expect(state.carriedCards.get("s1")?.cardKind).toBe("pr");
  });

  test("viewers, strangers and cards not on the board are refused", () => {
    const state = floor();
    const { c, rejected } = client("s1", "u-ada");
    run(state, c, "view", pick("issue", 7));
    run(state, c, null, pick("issue", 7));
    run(state, c, "manage", pick("issue", 9)); // #9 is a PR, not an issue
    run(state, c, "manage", pick("pr", 99));
    expect(rejected).toEqual([
      "you may not spawn henchmen in this operation",
      "you may not spawn henchmen in this operation",
      "that card is not on this operation's board",
      "that card is not on this operation's board",
    ]);
    expect(state.carriedCards.size).toBe(0);
  });
});

describe("card.drop", () => {
  test("on a free desk, or back on the board; a taken or unknown desk keeps it in hand", () => {
    const state = floor();
    const { c, rejected } = client("s1", "u-ada");
    run(state, c, "spawn", drop());
    expect(rejected).toEqual(["you are not carrying a card"]);

    run(state, c, "spawn", pick("issue", 7));
    run(state, c, "spawn", drop("desk-2"));
    run(state, c, "spawn", drop("no-such-desk"));
    expect(rejected.slice(1)).toEqual(["that desk is taken", "no such desk in this operation"]);
    expect(state.carriedCards.has("s1")).toBe(true);

    run(state, c, "spawn", drop("desk-1"));
    expect(state.carriedCards.has("s1")).toBe(false);

    run(state, c, "spawn", pick("pr", 9));
    run(state, c, "spawn", drop());
    expect(state.carriedCards.size).toBe(0);
  });

  test("one human's drop never touches another's card; leaving puts it back", () => {
    const state = floor();
    const ada = client("s1", "u-ada");
    const ben = client("s2", "u-ben");
    run(state, ada.c, "spawn", pick("issue", 7));
    run(state, ben.c, "spawn", pick("pr", 9));
    run(state, ben.c, "spawn", drop("desk-1"));
    expect([...state.carriedCards.keys()]).toEqual(["s1"]);
    dropCarriedOnLeave(state, "s1");
    dropCarriedOnLeave(state, "s-unknown");
    expect(state.carriedCards.size).toBe(0);
  });
});
