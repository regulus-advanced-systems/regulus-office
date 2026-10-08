import { describe, expect, test } from "bun:test";
import { LOBBY_LEVEL_ID, LOBBY_OPERATION_ID } from "@regulus/protocol";
import { liftSpotIn } from "@regulus/room-layout";
import { rng } from "@regulus/room-layout/src/compound/test-support.ts";
import { centreOf, corridorAt, inRect, type LairRoom, readLair, roomAt } from "./geometry.ts";
import { ACME, APOLLO, BOREALIS, lairState, person, type TestState } from "./test-lair.ts";
import { AgentWorld, STEP_MS, type WorldAgent } from "./world.ts";

const agent = (over: Partial<WorldAgent>): WorldAgent => ({
  id: "a1",
  name: "Quillon",
  ownerUserId: "ante",
  ownerName: "Ante",
  appearance: "secretary",
  status: "ready",
  dismissed: false,
  ...over,
});

function setup(agents: WorldAgent[], allowed: Record<string, string[]> = {}) {
  const state = lairState();
  const asked: string[] = [];
  const world = new AgentWorld({
    agents: () => agents,
    mayEnter: (agentId, operationId) => {
      asked.push(`${agentId}:${operationId}`);
      return allowed[agentId]?.includes(operationId) ?? false;
    },
    random: rng(7),
  });
  let now = 1_000_000;
  /** Step the world for `ms`, as the building room's sweep would. */
  const run = (ms: number) => {
    for (let t = 0; t < ms; t += 100) {
      now += 100;
      world.tick(state, now);
    }
  };
  const lair = readLair(state);
  const room = (levelId: string, id: string) =>
    lair.levels.get(levelId)?.rooms.find((r) => r.id === id) as LairRoom;
  const body = (id: string) => state.officeAgents.get(id);
  return { state, world, run, lair, room, body, asked, allowed, agents };
}

/** The project room (if any) a body's target is in. */
function projectRoomOf(s: ReturnType<typeof setup>, state: TestState, id: string): string | null {
  const body = state.officeAgents.get(id);
  if (!body) return null;
  const room = roomAt(s.lair.levels.get(body.levelId), body.target);
  return room?.kind === "project" ? room.id : null;
}

describe("AgentWorld", () => {
  test("does nothing while nobody is connected", () => {
    const s = setup([agent({})]);
    s.run(5_000);
    expect(s.state.officeAgents.size).toBe(0);
    expect(s.asked).toEqual([]);
  });

  test("every agent has a body, in the lobby, with its name, owner and looks", () => {
    const s = setup([
      agent({}),
      agent({ id: "s1", name: "Number Two", ownerUserId: null, ownerName: "" }),
    ]);
    person(s.state, "mia", centreOf(s.room(LOBBY_LEVEL_ID, LOBBY_OPERATION_ID).rect));
    s.run(STEP_MS);
    const shared = s.body("s1");
    expect(shared?.name).toBe("Number Two");
    expect(shared?.ownerUserId).toBe("");
    expect(shared?.mode).toBe("wander");
    expect(shared?.levelId).toBe(LOBBY_LEVEL_ID);
    expect(
      inRect(s.room(LOBBY_LEVEL_ID, LOBBY_OPERATION_ID).rect, shared?.target ?? { x: 0, z: 0 }),
    ).toBe(true);
    const mine = s.body("a1");
    expect(mine?.ownerName).toBe("Ante");
    expect(mine?.appearance).toBe("secretary");
    // Its owner is not here: it wanders like a dismissed one.
    expect(mine?.mode).toBe("wander");
  });

  test("a deleted agent's body goes", () => {
    const s = setup([agent({})]);
    person(s.state, "ante", { x: 60, z: 120 });
    s.run(STEP_MS);
    expect(s.body("a1")).toBeDefined();
    s.agents.length = 0;
    s.world.refresh();
    s.run(STEP_MS);
    expect(s.body("a1")).toBeUndefined();
  });

  test("a personal agent follows its owner at a polite distance, inside the room they are in", () => {
    const s = setup([agent({})]);
    const lobby = s.room(LOBBY_LEVEL_ID, LOBBY_OPERATION_ID).rect;
    const c = centreOf(lobby);
    person(s.state, "ante", c);
    s.run(STEP_MS);
    const body = s.body("a1");
    expect(body?.mode).toBe("follow");
    const gap = () =>
      Math.hypot((body?.target.x ?? 0) - owner().x, (body?.target.z ?? 0) - owner().z);
    const owner = () => s.state.humans.get("ante")?.position ?? { x: 0, z: 0 };
    expect(gap()).toBeGreaterThan(1);
    expect(gap()).toBeLessThan(2);
    // A small shuffle does not send it anywhere new: no patch.
    const before = { x: body?.target.x, z: body?.target.z };
    person(s.state, "ante", { x: c.x + 0.4, z: c.z });
    s.run(STEP_MS);
    expect({ x: body?.target.x, z: body?.target.z }).toEqual(before);
    // The owner walks into a corner: the agent's spot stays inside the lobby.
    person(s.state, "ante", { x: lobby.x + 0.3, z: lobby.z + 0.3 });
    s.run(STEP_MS);
    expect(inRect(lobby, body?.target ?? { x: 0, z: 0 })).toBe(true);
    expect(gap()).toBeLessThan(2.5);
    // Out into the corridor: its spot is in the corridor too, never across a wall.
    const corridor = s.lair.levels.get(LOBBY_LEVEL_ID)?.corridors[0];
    if (!corridor) throw new Error("no corridor");
    person(s.state, "ante", centreOf(corridor));
    s.run(STEP_MS);
    expect(
      corridorAt(s.lair.levels.get(LOBBY_LEVEL_ID), body?.target ?? { x: 0, z: 0 }),
    ).not.toBeNull();
    expect(body?.hop).toBe(1);
  });

  test("it changes level with its owner and goes into a room they may enter", () => {
    const s = setup([agent({})], { a1: [APOLLO] });
    person(s.state, "ante", { x: 60, z: 120 });
    s.run(STEP_MS);
    const hops = s.body("a1")?.hop ?? 0;
    const apollo = s.room(ACME, APOLLO);
    person(s.state, "ante", { ...centreOf(apollo.rect), levelId: ACME });
    s.run(STEP_MS);
    const body = s.body("a1");
    expect(body?.levelId).toBe(ACME);
    // Placed on the new level, not walked across the old one: it steps out of the lift on
    // that level's landing (#269), wherever its owner went.
    expect(body?.hop).toBe(hops + 1);
    const landing = s.room(ACME, "landing");
    expect(landing.kind).toBe("landing");
    expect(inRect(landing.rect, body?.target ?? { x: 0, z: 0 })).toBe(true);
    const lift = liftSpotIn(landing.tiles);
    const fromLift = Math.hypot(
      (body?.target.x ?? 0) - lift.stand.x,
      (body?.target.z ?? 0) - lift.stand.z,
    );
    expect(fromLift).toBeGreaterThan(0.5);
    expect(fromLift).toBeLessThan(2);
    // Not inside the shaft's housing.
    expect(inRect(lift.rect, body?.target ?? { x: 0, z: 0 })).toBe(false);
    expect(body?.operationId).toBe(LOBBY_OPERATION_ID);
    expect(body?.doing).toBe("stepping out of the lift");
    // Then it walks (no second hop) to its owner's side, into the room they may both enter.
    s.run(STEP_MS);
    expect(body?.hop).toBe(hops + 1);
    expect(body?.mode).toBe("follow");
    expect(body?.operationId).toBe(APOLLO);
    expect(inRect(apollo.rect, body?.target ?? { x: 0, z: 0 })).toBe(true);
    // Back up with its owner: by the lobby's lift, the same shaft.
    person(s.state, "ante", { x: 60, z: 120 });
    s.run(STEP_MS);
    expect(body?.levelId).toBe(LOBBY_LEVEL_ID);
    expect(body?.hop).toBe(hops + 2);
    expect(
      inRect(s.room(LOBBY_LEVEL_ID, LOBBY_OPERATION_ID).rect, body?.target ?? { x: 0, z: 0 }),
    ).toBe(true);
    expect(
      Math.hypot((body?.target.x ?? 0) - lift.stand.x, (body?.target.z ?? 0) - lift.stand.z),
    ).toBeLessThan(2);
  });

  test("a level other than the lobby level has a landing and none of the lobby's rooms to wander (#269)", () => {
    const s = setup([agent({ id: "s1", ownerUserId: null, ownerName: "" })], { s1: [APOLLO] });
    expect(s.lair.levels.get(ACME)?.rooms.map((r) => r.kind)).toEqual([
      "landing",
      "project",
      "project",
    ]);
    // Somebody is on Acme's level only: the shared agent wanders there.
    person(s.state, "sam", { x: 60, z: 120, levelId: ACME });
    const lobbyLevel = s.lair.levels.get(LOBBY_LEVEL_ID);
    const fixed = (lobbyLevel?.rooms ?? []).filter(
      (r) => r.kind === "conference" || r.kind === "break_room",
    );
    expect(fixed).toHaveLength(2);
    const doings = new Set<string>();
    let onAcme = 0;
    for (let i = 0; i < 120; i++) {
      s.run(3_000);
      const body = s.body("s1");
      if (!body || body.levelId !== ACME) continue;
      onAcme++;
      doings.add(body.doing);
      const level = s.lair.levels.get(ACME);
      const room = roomAt(level, body.target);
      // In the landing, in Apollo, or in a corridor; never where the lobby level has its
      // war room or break room (solid rock down here), nor in the room it may not enter.
      expect(room ? room.id : corridorAt(level, body.target) ? "corridor" : "rock").toMatch(
        /^(landing|op-apollo|corridor)$/,
      );
      for (const r of fixed) expect(inRect(r.rect, body.target)).toBe(false);
    }
    expect(onAcme).toBeGreaterThan(20);
    expect([...doings].some((d) => /landing|by the lift/.test(d))).toBe(true);
    expect([...doings].join("|")).not.toMatch(/war room|break room|lobby|snacks/);
  });

  test("it waits outside a room it may not enter, and comes in once it may", () => {
    const s = setup([agent({})], { a1: [APOLLO] });
    const borealis = s.room(ACME, BOREALIS);
    person(s.state, "ante", { ...centreOf(borealis.rect), levelId: ACME });
    // One step out of the lift on that level, the next to the door.
    s.run(2 * STEP_MS);
    const body = s.body("a1");
    expect(body?.mode).toBe("wait");
    expect(body?.operationId).toBe(LOBBY_OPERATION_ID);
    expect(body?.doing).toBe("waiting at the door");
    expect(inRect(borealis.rect, body?.target ?? { x: 0, z: 0 })).toBe(false);
    // Just outside the door (south side), within a corridor's width of the wall.
    expect((body?.target.z ?? 0) - (borealis.rect.z + borealis.rect.d)).toBeGreaterThan(0);
    expect((body?.target.z ?? 0) - (borealis.rect.z + borealis.rect.d)).toBeLessThan(4.1);
    // The owner walks about inside: the agent stays put.
    person(s.state, "ante", { x: borealis.rect.x + 2, z: borealis.rect.z + 2, levelId: ACME });
    s.run(1_000);
    expect(body?.mode).toBe("wait");
    // Access is granted (the gate now says yes): it joins them.
    s.allowed.a1?.push(BOREALIS);
    s.run(4_000);
    expect(body?.mode).toBe("follow");
    expect(body?.operationId).toBe(BOREALIS);
    expect(inRect(borealis.rect, body?.target ?? { x: 0, z: 0 })).toBe(true);
  });

  test("a room still being built is shut, whatever the access", () => {
    const s = setup([agent({})], { a1: [APOLLO] });
    const apollo = s.state.operations.get(APOLLO);
    if (apollo) apollo.buildState = "building";
    person(s.state, "ante", { ...centreOf(s.room(ACME, APOLLO).rect), levelId: ACME });
    s.run(STEP_MS);
    expect(s.body("a1")?.mode).toBe("wait");
  });

  test("dismissed, it wanders; recalled, it comes back to its owner's side", () => {
    const agents = [agent({})];
    const s = setup(agents);
    const c = centreOf(s.room(LOBBY_LEVEL_ID, LOBBY_OPERATION_ID).rect);
    person(s.state, "ante", c);
    s.run(STEP_MS);
    expect(s.body("a1")?.mode).toBe("follow");
    agents[0] = agent({ dismissed: true });
    s.world.refresh();
    s.run(STEP_MS);
    const body = s.body("a1");
    expect(body?.mode).toBe("wander");
    expect(body?.dismissed).toBe(true);
    const near = { x: body?.target.x, z: body?.target.z };
    s.run(6_000);
    // It has set off to a spot of its own.
    expect({ x: body?.target.x, z: body?.target.z }).not.toEqual(near);
    expect(body?.doing).not.toBe("");
    agents[0] = agent({ dismissed: false });
    s.world.refresh();
    s.run(STEP_MS);
    expect(body?.mode).toBe("follow");
    expect(body?.dismissed).toBe(false);
    expect(Math.hypot((body?.target.x ?? 0) - c.x, (body?.target.z ?? 0) - c.z)).toBeLessThan(2);
  });

  test("when its owner leaves it wanders, and rejoins them on return", () => {
    const s = setup([agent({})]);
    person(s.state, "ante", { x: 60, z: 120 });
    person(s.state, "mia", { x: 62, z: 118 });
    s.run(STEP_MS);
    expect(s.body("a1")?.mode).toBe("follow");
    s.state.humans.delete("ante");
    s.run(STEP_MS);
    expect(s.body("a1")?.mode).toBe("wander");
    person(s.state, "ante", { x: 60, z: 120 });
    s.run(STEP_MS);
    expect(s.body("a1")?.mode).toBe("follow");
  });

  test("wandering stays in the fixed rooms, the corridors and the rooms the gate allows", () => {
    const s = setup(
      [
        agent({ id: "s1", name: "Number Two", ownerUserId: null, ownerName: "" }),
        agent({ id: "p1", dismissed: true }),
      ],
      { s1: [APOLLO], p1: [] },
    );
    // Somebody on each level, so both are wandered.
    person(s.state, "mia", { x: 60, z: 120 });
    person(s.state, "sam", { x: 60, z: 120, levelId: ACME });
    const visited = { s1: new Set<string>(), p1: new Set<string>() };
    const levels = new Set<string>();
    for (let i = 0; i < 400; i++) {
      s.run(3_000);
      for (const id of ["s1", "p1"] as const) {
        const body = s.body(id);
        if (!body) throw new Error("no body");
        levels.add(body.levelId);
        const level = s.lair.levels.get(body.levelId);
        const room = roomAt(level, body.target);
        // Always somewhere real: a room or a corridor of the level it is on.
        expect(room !== null || corridorAt(level, body.target) !== null).toBe(true);
        const project = projectRoomOf(s, s.state, id);
        if (project) visited[id].add(project);
        // What it says about itself agrees with where it is.
        expect(body.operationId).toBe(project ?? LOBBY_OPERATION_ID);
      }
    }
    expect([...visited.s1]).toEqual([APOLLO]);
    expect([...visited.p1]).toEqual([]);
    expect(levels.has(ACME)).toBe(true);
    expect(levels.has(LOBBY_LEVEL_ID)).toBe(true);
  });

  test("a wandering agent only goes to levels somebody is on", () => {
    const s = setup([agent({ id: "s1", ownerUserId: null, ownerName: "" })], { s1: [APOLLO] });
    person(s.state, "mia", { x: 60, z: 120 });
    for (let i = 0; i < 100; i++) {
      s.run(3_000);
      expect(s.body("s1")?.levelId).toBe(LOBBY_LEVEL_ID);
    }
  });

  test("an agent in a room it loses is walked out to the door", () => {
    const s = setup([agent({ id: "s1", ownerUserId: null, ownerName: "" })], { s1: [APOLLO] });
    person(s.state, "sam", { x: 60, z: 120, levelId: ACME });
    for (let i = 0; i < 200 && s.body("s1")?.operationId !== APOLLO; i++) s.run(3_000);
    expect(s.body("s1")?.operationId).toBe(APOLLO);
    s.allowed.s1 = [];
    s.run(4_000);
    const body = s.body("s1");
    expect(body?.operationId).toBe(LOBBY_OPERATION_ID);
    expect(projectRoomOf(s, s.state, "s1")).toBeNull();
    expect(body?.levelId).toBe(ACME);
  });

  test("two agents of one person stand in different places", () => {
    const s = setup([agent({}), agent({ id: "a2", name: "Tally" })]);
    person(s.state, "ante", { x: 60, z: 120 });
    s.run(STEP_MS);
    const a = s.body("a1")?.target;
    const b = s.body("a2")?.target;
    expect(Math.hypot((a?.x ?? 0) - (b?.x ?? 0), (a?.z ?? 0) - (b?.z ?? 0))).toBeGreaterThan(0.8);
  });

  test("a scripted route visits its stops in order and skips rooms it may not enter", () => {
    const s = setup([agent({ id: "pm", ownerUserId: null, ownerName: "" })], { pm: [APOLLO] });
    person(s.state, "sam", { x: 60, z: 120, levelId: ACME });
    s.run(STEP_MS);
    const stop = (id: string, doing: string) => ({
      ...centreOf(s.room(ACME, id).rect),
      heading: 0,
      levelId: ACME,
      doing,
      pauseMs: 1_000,
    });
    s.world.setRoute("pm", [stop(APOLLO, "visiting Apollo"), stop(BOREALIS, "visiting Borealis")]);
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) {
      s.run(2_000);
      seen.add(s.body("pm")?.doing ?? "");
      expect(s.body("pm")?.mode).toBe("route");
    }
    // It came down by the lift first (#269), then kept to the stop it may stand at.
    expect([...seen].sort()).toEqual(["stepping out of the lift", "visiting Apollo"]);
    s.world.setRoute("pm", null);
    s.run(STEP_MS);
    expect(s.body("pm")?.mode).toBe("wander");
  });
});
