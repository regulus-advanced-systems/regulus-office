/**
 * A board helper's body (#56): at its board in its own room and nowhere else.
 * It has no body while it cannot stand there, so its name is never seen in the
 * lobby or a corridor by people who cannot see its room.
 */
import { describe, expect, test } from "bun:test";
import { LOBBY_LEVEL_ID, LOBBY_OPERATION_ID } from "@regulus/protocol";
import { rng } from "@regulus/room-layout/src/compound/test-support.ts";
import { centreOf, inRect, readLair } from "./geometry.ts";
import { boardPost } from "./posts.ts";
import { ACME, APOLLO, BOREALIS, lairState, person } from "./test-lair.ts";
import { ACCESS_TTL_MS, AgentWorld, SYNC_MS, type WorldAgent } from "./world.ts";

const helper = (over: Partial<WorldAgent> = {}): WorldAgent => ({
  id: "k1",
  name: "Apollo issues",
  ownerUserId: null,
  ownerName: "",
  appearance: "standard",
  status: "stopped",
  dismissed: false,
  post: "issue_board",
  postRoom: APOLLO,
  ...over,
});

function setup(agents: WorldAgent[], allowed: Record<string, string[]>) {
  const state = lairState();
  const world = new AgentWorld({
    agents: () => agents,
    mayEnter: (agentId, operationId) => allowed[agentId]?.includes(operationId) ?? false,
    random: rng(3),
  });
  let now = 2_000_000;
  const run = (ms: number) => {
    for (let t = 0; t < ms; t += 100) {
      now += 100;
      world.tick(state, now);
    }
  };
  const lair = readLair(state);
  const room = (id: string) => {
    const found = lair.levels.get(ACME)?.rooms.find((r) => r.id === id);
    if (!found) throw new Error(`no room ${id}`);
    return found;
  };
  return { state, world, run, lair, room, allowed, agents };
}

describe("a board helper's post", () => {
  test("each board has its own place, inside the room, beside the board", () => {
    const { lair, room } = setup([], {});
    const apollo = room(APOLLO);
    const spots = (["issue_board", "pr_board", "queue_clipboard"] as const).map((post) => {
      const spot = boardPost(lair, { post, postRoom: APOLLO });
      if (!spot) throw new Error(`no post at ${post}`);
      expect(spot.levelId).toBe(ACME);
      expect(spot.operationId).toBe(APOLLO);
      expect(inRect(apollo.rect, spot)).toBe(true);
      return spot;
    });
    expect(spots.map((s) => s.doing)).toEqual([
      "at the issue board",
      "at the pull request board",
      "at the task queue",
    ]);
    // No two helpers on top of each other.
    for (const [i, a] of spots.entries()) {
      for (const b of spots.slice(i + 1)) {
        expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(0.8);
      }
    }
  });

  test("no post without a room, or for an agent that is not a helper", () => {
    const { lair } = setup([], {});
    expect(boardPost(lair, { post: "issue_board", postRoom: "nope" })).toBeNull();
    expect(boardPost(lair, { post: "issue_board" })).toBeNull();
    expect(boardPost(lair, { post: "reception", postRoom: APOLLO })).toBeNull();
    expect(boardPost(lair, { post: "none", postRoom: APOLLO })).toBeNull();
  });
});

describe("a board helper in the world", () => {
  test("it stands at its board and stays there, however long", () => {
    const s = setup([helper()], { k1: [APOLLO] });
    person(s.state, "mia", centreOf(s.room(APOLLO).rect));
    s.run(400);
    const body = s.state.officeAgents.get("k1");
    const post = boardPost(s.lair, helper());
    expect(body?.mode).toBe("post");
    expect(body?.post).toBe("issue_board");
    expect(body?.levelId).toBe(ACME);
    expect(body?.operationId).toBe(APOLLO);
    expect(body?.doing).toBe("at the issue board");
    expect({ x: body?.target.x, z: body?.target.z }).toEqual({ x: post?.x, z: post?.z });
    const hop = body?.hop;
    s.run(5 * 60_000);
    expect(body?.mode).toBe("post");
    expect(body?.operationId).toBe(APOLLO);
    expect({ x: body?.target.x, z: body?.target.z }).toEqual({ x: post?.x, z: post?.z });
    expect(body?.hop).toBe(hop);
  });

  test("it is never anywhere but its room: no body in the lobby, on any level", () => {
    const s = setup([helper()], { k1: [APOLLO] });
    const lobby = s.lair.levels.get(LOBBY_LEVEL_ID)?.rooms.find((r) => r.kind === "lobby");
    if (!lobby) throw new Error("no lobby");
    person(s.state, "olga", centreOf(lobby.rect));
    for (let i = 0; i < 40; i++) {
      s.run(3_000);
      const body = s.state.officeAgents.get("k1");
      expect(body?.operationId).toBe(APOLLO);
      expect(body?.operationId).not.toBe(LOBBY_OPERATION_ID);
    }
  });

  test("let out of its room, or its room not built yet, it has no body at all", () => {
    const s = setup([helper()], { k1: [APOLLO] });
    person(s.state, "mia", centreOf(s.room(APOLLO).rect));
    s.run(400);
    expect(s.state.officeAgents.has("k1")).toBe(true);
    s.allowed.k1 = [];
    s.world.refresh();
    s.run(400);
    expect(s.state.officeAgents.has("k1")).toBe(false);
    // Let back in: it is at its board again, once the access answer is asked anew.
    s.allowed.k1 = [APOLLO];
    s.run(ACCESS_TTL_MS + SYNC_MS + 400);
    expect(s.state.officeAgents.get("k1")?.operationId).toBe(APOLLO);

    const room = s.state.operations.get(APOLLO);
    if (!room) throw new Error("no Apollo");
    room.buildState = "building";
    s.run(SYNC_MS + 400);
    expect(s.state.officeAgents.has("k1")).toBe(false);
  });

  test("a helper of another room does not turn up in this one", () => {
    const s = setup([helper(), helper({ id: "k2", name: "Borealis queue", postRoom: BOREALIS })], {
      k1: [APOLLO],
      k2: [BOREALIS],
    });
    person(s.state, "mia", centreOf(s.room(APOLLO).rect));
    s.run(60_000);
    expect(s.state.officeAgents.get("k1")?.operationId).toBe(APOLLO);
    expect(s.state.officeAgents.get("k2")?.operationId).toBe(BOREALIS);
  });
});
