/**
 * The office PM in the world (#60): its post at reception, its rounds by the
 * clock through the rooms it was granted, where it stops, and whom it tells.
 */
import { describe, expect, test } from "bun:test";
import { LOBBY_LEVEL_ID, LOBBY_OPERATION_ID } from "@regulus/protocol";
import { projectRoomLayout, receptionSpec } from "@regulus/room-layout";
import { rng } from "@regulus/room-layout/src/compound/test-support.ts";
import { inRect, type LairRoom, lobbyOf, readLair, roomAt } from "./geometry.ts";
import {
  BOARD_PAUSE_MS,
  PmRounds,
  ROUND_START_WINDOW_MS,
  type RoundHenchman,
  receptionPost,
  roomStops,
  roundHenchmanOf,
  roundRooms,
  roundSlot,
  stopPace,
  WAITING_PAUSE_MS,
} from "./rounds.ts";
import type { RouteVisit } from "./route.ts";
import { ACME, APOLLO, BOREALIS, lairState, person } from "./test-lair.ts";
import type { OwnerWhereabouts, WorldAgent } from "./types.ts";
import { AgentWorld } from "./world.ts";

const EVERY = 15 * 60_000;
/** The start of a round, and a moment well inside one. */
const ON_THE_QUARTER = 1_000 * EVERY;

const pm = (over: Partial<WorldAgent> = {}): WorldAgent => ({
  id: "pm",
  name: "Ledger",
  ownerUserId: null,
  ownerName: "",
  appearance: "number_two",
  status: "ready",
  dismissed: false,
  post: "reception",
  ...over,
});

const henchman = (over: Partial<RoundHenchman> = {}): RoundHenchman => ({
  agentId: "h1",
  name: "Gasket",
  operationId: APOLLO,
  seatId: "d1s1",
  ownerUserId: "mia",
  ownerName: "Mia",
  state: "waiting",
  ...over,
});

function setup(
  agents: WorldAgent[],
  allowed: Record<string, string[]>,
  options: { henchmen?: RoundHenchman[]; startAt?: number } = {},
) {
  const state = lairState();
  const henchmen = options.henchmen ?? [];
  const rounds = new PmRounds({ henchmen: () => henchmen, everyMs: EVERY });
  const visits: Array<{ agent: string; visit: RouteVisit; owner: OwnerWhereabouts; at: number }> =
    [];
  let now = options.startAt ?? ON_THE_QUARTER - 5_000;
  const world = new AgentWorld({
    agents: () => agents,
    mayEnter: (agentId, operationId) => allowed[agentId]?.includes(operationId) ?? false,
    duty: (agent, context) => rounds.duty(agent, context),
    standingBy: (agent, visit, owner) => visits.push({ agent: agent.id, visit, owner, at: now }),
    random: rng(11),
  });
  /** Step the world for `ms`, as the building room's sweep would; `each` runs after every step. */
  const run = (ms: number, each?: () => void) => {
    for (let t = 0; t < ms; t += 100) {
      now += 100;
      world.tick(state, now);
      each?.();
    }
  };
  const lair = readLair(state);
  const room = (levelId: string, id: string) =>
    lair.levels.get(levelId)?.rooms.find((r) => r.id === id) as LairRoom;
  const body = (id = "pm") => {
    const b = state.officeAgents.get(id);
    if (!b) throw new Error(`no body for ${id}`);
    return b;
  };
  const post = receptionPost(lair);
  if (!post) throw new Error("no reception");
  return { state, world, run, lair, room, body, visits, henchmen, allowed, post, now: () => now };
}

/** Everything a body does over `ms`: each new (mode, room, doing) once, in order. */
function trail(s: ReturnType<typeof setup>, ms: number) {
  const seen: string[] = [];
  s.run(ms, () => {
    const b = s.body();
    const at = `${b.mode}|${b.levelId}|${b.operationId}|${b.doing}`;
    if (seen[seen.length - 1] !== at) seen.push(at);
    // Where it says it is agrees with where it is sent.
    const room = roomAt(s.lair.levels.get(b.levelId), b.target);
    expect(b.operationId).toBe(room?.kind === "project" ? room.id : LOBBY_OPERATION_ID);
  });
  return seen;
}

describe("reception", () => {
  test("the post is behind the reception desk, inside the lobby, facing the room", () => {
    const s = setup([pm()], {});
    const lobby = lobbyOf(s.lair.levels.get(LOBBY_LEVEL_ID)) as LairRoom;
    const spec = receptionSpec(lobby.rect.w, lobby.rect.d);
    expect(inRect(lobby.rect, s.post, -0.5)).toBe(true);
    // Between the wall and the counter, and not in the chair.
    expect(spec.post.x).toBeLessThan(spec.desk.x - 0.3);
    expect(Math.hypot(spec.post.x - spec.chair.x, spec.post.z - spec.chair.z)).toBeGreaterThan(0.9);
    expect(spec.post.z).toBeGreaterThan(spec.desk.z);
    expect(spec.post.z).toBeLessThan(spec.desk.z + spec.desk.d);
    // A visitor stands across the counter from it.
    expect(spec.visitor.x).toBeGreaterThan(spec.desk.x + spec.desk.w + 0.5);
    expect(s.post.levelId).toBe(LOBBY_LEVEL_ID);
  });

  test("the office PM appears at reception and stays there; other shared agents wander", () => {
    const s = setup([pm(), pm({ id: "other", name: "Tally", post: "none" })], {});
    person(s.state, "mia", { x: 60, z: 120 });
    s.run(400);
    expect(s.body()).toMatchObject({
      mode: "post",
      post: "reception",
      doing: "at reception",
      levelId: LOBBY_LEVEL_ID,
      operationId: LOBBY_OPERATION_ID,
    });
    expect(s.body().target.x).toBe(s.post.x);
    expect(s.body().target.z).toBe(s.post.z);
    expect(s.body("other")).toMatchObject({ mode: "wander", post: "none" });
    // With no room to visit there is no round: it is still at its desk an hour later.
    const patches = s.body().hop;
    expect(trail(s, 60 * 60_000)).toEqual(["post|lobby|lobby|at reception"]);
    expect(s.body().hop).toBe(patches);
    expect(s.body("other").mode).toBe("wander");
  });

  test("an agent whose job stops being office PM goes back to wandering", () => {
    const agents = [pm()];
    const s = setup(agents, {});
    person(s.state, "mia", { x: 60, z: 120 });
    s.run(400);
    expect(s.body().mode).toBe("post");
    agents[0] = pm({ post: "none" });
    s.world.refresh();
    s.run(3_000);
    expect(s.body()).toMatchObject({ mode: "wander", post: "none" });
  });

  test("nothing happens while nobody is connected, a round included", () => {
    const s = setup([pm()], { pm: [APOLLO] });
    s.run(EVERY * 2);
    expect(s.state.officeAgents.size).toBe(0);
  });
});

describe("the clock", () => {
  test("a round starts on the quarter, once, and not when its start was missed", () => {
    const rounds = new PmRounds({ henchmen: () => [], everyMs: EVERY });
    const lair = readLair(lairState());
    const ask = (now: number, agent = pm()) =>
      rounds.duty(agent, { lair, mayEnter: (id) => id === APOLLO, now });
    expect(roundSlot(ON_THE_QUARTER - 1, EVERY)).toBe(999);
    expect(roundSlot(ON_THE_QUARTER, EVERY)).toBe(1000);
    // Mid-slot (the office just woke up): no round until the next quarter.
    expect(ask(ON_THE_QUARTER - EVERY / 2)).toBeNull();
    expect(ask(ON_THE_QUARTER - 1)).toBeNull();
    expect(ask(ON_THE_QUARTER + 300)).not.toBeNull();
    expect(ask(ON_THE_QUARTER + 600)).toBeNull();
    expect(ask(ON_THE_QUARTER + EVERY - 1)).toBeNull();
    // Nobody was connected at the next start: that round is skipped, the one after is walked.
    expect(ask(ON_THE_QUARTER + EVERY + ROUND_START_WINDOW_MS + 1)).toBeNull();
    expect(ask(ON_THE_QUARTER + 2 * EVERY)).not.toBeNull();
    // Only an agent with the reception post does rounds.
    expect(ask(ON_THE_QUARTER + 3 * EVERY, pm({ id: "x", post: "none" }))).toBeNull();
  });

  test("the same clock and grants give the same round, whoever starts it", () => {
    const walk = () => {
      const s = setup([pm()], { pm: [APOLLO, BOREALIS] }, { henchmen: [henchman()] });
      person(s.state, "sam", { x: 60, z: 120 });
      return trail(s, EVERY);
    };
    const first = walk();
    expect(first.length).toBeGreaterThan(5);
    expect(walk()).toEqual(first);
  });

  test("rooms: granted and built only, lobby level first, by id; a big office is covered in turns", () => {
    const state = lairState();
    const lair = readLair(state);
    const ids = (may: (id: string) => boolean, slot = 0) =>
      roundRooms(lair, may, slot).map((r) => r.id);
    expect(ids(() => true)).toEqual([APOLLO, BOREALIS]);
    expect(ids((id) => id === BOREALIS)).toEqual([BOREALIS]);
    expect(ids(() => false)).toEqual([]);
    const borealis = state.operations.get(BOREALIS);
    if (borealis) borealis.buildState = "building";
    expect(roundRooms(readLair(state), () => true, 0).map((r) => r.id)).toEqual([APOLLO]);
  });
});

describe("stops", () => {
  test("rounds less than two minutes apart keep their stops short, down to a quarter", () => {
    expect(stopPace(15 * 60_000)).toBe(1);
    expect(stopPace(2 * 60_000)).toBe(1);
    expect(stopPace(60_000)).toBe(0.5);
    expect(stopPace(5_000)).toBe(0.25);
    const s = setup([pm()], {});
    const apollo = s.room(ACME, APOLLO);
    const pauses = (pace?: number) => roomStops(apollo, [henchman()], pace).map((x) => x.pauseMs);
    expect(pauses()).toEqual([BOARD_PAUSE_MS, BOARD_PAUSE_MS, WAITING_PAUSE_MS]);
    expect(pauses(0.25)).toEqual([1_000, 1_000, 2_000]);
    // The same places either way.
    expect(roomStops(apollo, [henchman()], 0.25).map((x) => [x.x, x.z])).toEqual(
      roomStops(apollo, [henchman()]).map((x) => [x.x, x.z]),
    );
  });
});

describe("a round", () => {
  test("goes through the granted rooms only, stops at the boards, and returns to reception", () => {
    const s = setup([pm()], { pm: [APOLLO] });
    person(s.state, "sam", { x: 60, z: 120 });
    s.run(400);
    expect(s.body().mode).toBe("post");
    const seen = trail(s, EVERY - 10_000);
    expect(seen).toEqual([
      "post|lobby|lobby|at reception",
      // A change of level is by the lift (#269): out on the landing, then on foot.
      `route|${ACME}|lobby|stepping out of the lift`,
      `route|${ACME}|${APOLLO}|checking the issue board`,
      `route|${ACME}|${APOLLO}|checking the PR board`,
      "post|lobby|lobby|stepping out of the lift",
      "post|lobby|lobby|at reception",
    ]);
    expect(s.body().target.x).toBe(s.post.x);
    expect(s.body().target.z).toBe(s.post.z);
    expect(s.visits).toEqual([]);
  });

  test("stands by henchmen that wait or have finished, waiting ones first", () => {
    const henchmen = [
      henchman({ agentId: "h-done", name: "Rivet", seatId: "d1s2", state: "finished" }),
      henchman({ agentId: "h-wait", name: "Gasket", seatId: "d2s1" }),
      // In a room the PM was not granted: never visited.
      henchman({ agentId: "h-closed", name: "Shim", operationId: BOREALIS }),
    ];
    const s = setup([pm()], { pm: [APOLLO] }, { henchmen });
    person(s.state, "sam", { x: 60, z: 120 });
    const stood: Array<{ doing: string; x: number; z: number }> = [];
    const seen: string[] = [];
    s.run(EVERY - 10_000, () => {
      const b = s.body();
      if (seen[seen.length - 1] === b.doing) return;
      seen.push(b.doing);
      stood.push({ doing: b.doing, x: b.target.x, z: b.target.z });
    });
    expect(seen).toEqual([
      "at reception",
      "stepping out of the lift",
      "checking the issue board",
      "checking the PR board",
      "Gasket is waiting for Mia",
      "Rivet has finished",
      "stepping out of the lift",
      "at reception",
    ]);
    // Next to each one's own chair, inside the room, and not on any furniture.
    const apollo = s.room(ACME, APOLLO);
    const layout = projectRoomLayout({
      width: apollo.tiles.w,
      depth: apollo.tiles.d,
      doorSide: apollo.doorSide,
      deskCount: apollo.deskCount,
      decorStyle: apollo.decorStyle,
    });
    if (!layout) throw new Error("no layout");
    for (const [doing, seatId] of [
      ["Gasket is waiting for Mia", "d2s1"],
      ["Rivet has finished", "d1s2"],
    ] as const) {
      const at = stood.find((p) => p.doing === doing);
      const seat = layout.seats.find((x) => x.id === seatId);
      if (!at || !seat) throw new Error(`no stop for ${seatId}`);
      const local = { x: at.x - apollo.rect.x, z: at.z - apollo.rect.z };
      const gap = Math.hypot(local.x - seat.pose.x, local.z - seat.pose.z);
      expect(gap).toBeGreaterThan(0.6);
      expect(gap).toBeLessThan(1.5);
      expect(inRect(apollo.rect, at, -0.4)).toBe(true);
      for (const o of layout.obstacles) {
        expect(inRect(o.rect, local)).toBe(false);
      }
    }
    expect(s.visits.map((v) => v.visit.henchmanId)).toEqual(["h-wait", "h-done"]);
  });

  test("a room it loses on the way is skipped; it never stands in a room outside its grants", () => {
    const s = setup(
      [pm()],
      { pm: [APOLLO, BOREALIS] },
      { henchmen: [henchman({ operationId: BOREALIS, agentId: "h-b" })] },
    );
    person(s.state, "sam", { x: 60, z: 120 });
    const rooms = new Set<string>();
    s.run(EVERY - 10_000, () => {
      const b = s.body();
      rooms.add(b.operationId);
      // The grant on Borealis is taken away while it is still in Apollo.
      if (b.operationId === APOLLO) s.allowed.pm = [APOLLO];
      const room = roomAt(s.lair.levels.get(b.levelId), b.target);
      if (room?.kind === "project") expect(s.allowed.pm).toContain(room.id);
    });
    expect([...rooms].sort()).toEqual([LOBBY_OPERATION_ID, APOLLO].sort());
    expect(s.visits).toEqual([]);
    expect(s.body().mode).toBe("post");
  });

  test("a room still being built is not walked into", () => {
    const s = setup([pm()], { pm: [APOLLO, BOREALIS] });
    const apollo = s.state.operations.get(APOLLO);
    if (apollo) apollo.buildState = "building";
    person(s.state, "sam", { x: 60, z: 120 });
    const rooms = new Set<string>();
    s.run(EVERY - 10_000, () => rooms.add(s.body().operationId));
    expect([...rooms].sort()).toEqual([LOBBY_OPERATION_ID, BOREALIS].sort());
  });

  test("the next round starts on the next quarter", () => {
    const s = setup([pm()], { pm: [APOLLO] });
    person(s.state, "sam", { x: 60, z: 120 });
    const starts: number[] = [];
    let last = "";
    s.run(EVERY * 3, () => {
      const mode = s.body().mode;
      if (mode === "route" && last !== "route") starts.push(s.now());
      last = mode;
    });
    expect(starts.length).toBe(3);
    for (const [i, at] of starts.entries()) {
      expect(at - (ON_THE_QUARTER + i * EVERY)).toBeGreaterThanOrEqual(0);
      expect(at - (ON_THE_QUARTER + i * EVERY)).toBeLessThan(1_000);
    }
  });
});

describe("telling the owner", () => {
  const visitOf = (where: { x: number; z: number; levelId?: string } | null) => {
    const s = setup([pm()], { pm: [APOLLO] }, { henchmen: [henchman()] });
    person(s.state, "sam", { x: 60, z: 120 });
    if (where) person(s.state, "mia", where);
    let sentAt = 0;
    s.run(EVERY - 10_000, () => {
      if (!sentAt && s.body().doing === "Gasket is waiting for Mia") sentAt = s.now();
    });
    return { s, sentAt };
  };

  test("the owner is in the office but somewhere else: reported once it stands there", () => {
    const { s, sentAt } = visitOf({ x: 60, z: 120 });
    expect(s.visits.map((v) => [v.agent, v.visit.henchmanId, v.owner])).toEqual([
      ["pm", "h1", "elsewhere"],
    ]);
    // Not when it sets off towards the henchman: when it has had time to get there.
    expect((s.visits[0]?.at ?? 0) - sentAt).toBeGreaterThan(300);
  });

  test("the owner on the same level but outside the room is elsewhere too", () => {
    const { s } = visitOf({ x: 60, z: 120, levelId: ACME });
    expect(s.visits.map((v) => v.owner)).toEqual(["elsewhere"]);
  });

  test("the owner is in the room, or not connected: nobody to tell", () => {
    const probe = setup([pm()], {});
    const apollo = probe.room(ACME, APOLLO);
    const inside = {
      x: apollo.rect.x + apollo.rect.w / 2,
      z: apollo.rect.z + apollo.rect.d / 2,
      levelId: ACME,
    };
    expect(visitOf(inside).s.visits.map((v) => v.owner)).toEqual(["in_the_room"]);
    expect(visitOf(null).s.visits.map((v) => v.owner)).toEqual(["away"]);
  });

  test("every round stands by a henchman that still waits (the notice itself is once: center.test.ts)", () => {
    const s = setup([pm()], { pm: [APOLLO] }, { henchmen: [henchman()] });
    person(s.state, "mia", { x: 60, z: 120 });
    s.run(EVERY * 3 - 10_000);
    expect(s.visits.length).toBe(3);
    // It went back to work: the fourth round has nobody to stand by.
    s.henchmen.length = 0;
    s.run(EVERY);
    expect(s.visits.length).toBe(3);
  });
});

describe("what the rounds know of a henchman", () => {
  const view = {
    agentId: "h1",
    name: "Gasket",
    operationId: APOLLO,
    seatId: "d1s1",
    ownerUserId: "mia",
    ownerName: "Mia",
    seen: false,
  };

  test("waiting and unseen finished ones only, and nothing of their work", () => {
    expect(roundHenchmanOf({ ...view, status: "waiting_permission" })?.state).toBe("waiting");
    expect(roundHenchmanOf({ ...view, status: "waiting_input" })?.state).toBe("waiting");
    expect(roundHenchmanOf({ ...view, status: "done" })?.state).toBe("finished");
    expect(roundHenchmanOf({ ...view, status: "done", seen: true })).toBeNull();
    for (const status of ["working", "idle", "starting", "error", "exited"] as const) {
      expect(roundHenchmanOf({ ...view, status })).toBeNull();
    }
    const full = { ...view, status: "waiting_input" as const, taskTitle: "secret plan", ask: "x" };
    expect(Object.keys(roundHenchmanOf(full) ?? {}).sort()).toEqual(
      ["agentId", "name", "operationId", "ownerName", "ownerUserId", "seatId", "state"].sort(),
    );
  });

  test("a line never carries more than names; a seat that is gone is passed over", () => {
    const s = setup([pm()], {});
    const apollo = s.room(ACME, APOLLO);
    const stops = roomStops(apollo, [
      henchman({ name: "", ownerName: "" }),
      henchman({ agentId: "h2", seatId: "nowhere" }),
    ]);
    expect(stops.map((x) => x.doing)).toEqual([
      "checking the issue board",
      "checking the PR board",
      "a henchman is waiting",
    ]);
    for (const stop of stops) expect(inRect(apollo.rect, stop)).toBe(true);
  });
});
