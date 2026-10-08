import { afterEach, describe, expect, test } from "bun:test";
import type { BuildingState, LevelState, OperationInfo } from "@regulus/protocol";
import { LOBBY_LEVEL_ID } from "@regulus/protocol";
import { liftOf } from "../scene/compound/lift/spot.ts";
import { rowPlacement, testState } from "../scene/compound/testing.ts";
import { useBuildingStore } from "./building.ts";
import { syncCompoundWorld, useCompoundStore } from "./compound.ts";
import { useLevelStore } from "./level.ts";
import { RIDE_MS, rideLift, ridePhase, rideStyle, useLiftStore } from "./lift.ts";
import { useOperationsStore } from "./operations.ts";
import { usePlayerStore } from "./player.ts";

const lobby = testState([]);
const octo = testState([{ id: "apollo", placement: rowPlacement(4) }], 48, {
  levelId: "lv-octo",
  landing: true,
});
const LEVELS: LevelState[] = [
  {
    levelId: LOBBY_LEVEL_ID,
    kind: "lobby",
    login: "",
    name: "Lobby",
    order: 0,
    compound: lobby.compound,
  },
  {
    levelId: "lv-octo",
    kind: "org",
    login: "octo",
    name: "Octo",
    order: 1,
    compound: octo.compound,
  },
];

function publish(levels = LEVELS) {
  useBuildingStore.setState({
    state: {
      compound: lobby.compound,
      levels: Object.fromEntries(levels.map((l) => [l.levelId, l])),
      operations: { ...lobby.operations, ...octo.operations },
      humans: {},
    } as unknown as BuildingState,
    sessionId: "me",
  });
  useOperationsStore.setState({ operations: [{ operationId: "apollo" } as OperationInfo] });
  syncCompoundWorld();
}

/** Timers the test fires by hand, in order of their delay. */
function timers() {
  const pending: Array<{ fn: () => void; ms: number }> = [];
  return {
    schedule: (fn: () => void, ms: number) => pending.push({ fn, ms }),
    delays: () => pending.map((p) => p.ms),
    fire: (ms: number) => pending.filter((p) => p.ms === ms).forEach((p) => p.fn()),
  };
}

afterEach(() => {
  useLiftStore.setState({ ride: null, arrivedAt: null });
  useLevelStore.setState({ levelId: LOBBY_LEVEL_ID });
  useBuildingStore.getState().clear();
  useOperationsStore.setState({ operations: null });
  useCompoundStore.setState({ world: null });
  usePlayerStore.getState().reset();
});

describe("how the ride looks (#269)", () => {
  test("reduced motion cuts, the low preset fades, otherwise the doors close and open", () => {
    expect(rideStyle(true, "high")).toBe("cut");
    expect(rideStyle(true, "low")).toBe("cut");
    expect(rideStyle(false, "low")).toBe("fade");
    expect(rideStyle(false, "medium")).toBe("doors");
    expect(rideStyle(false, "high")).toBe("doors");
    expect(RIDE_MS.cut).toBe(0);
    expect(RIDE_MS.fade).toBeLessThan(RIDE_MS.doors);
    expect(RIDE_MS.doors).toBeLessThanOrEqual(2000);
  });

  test("the doors close, the lift moves, the doors open", () => {
    expect(ridePhase(0, 1500)).toBe("closing");
    expect(ridePhase(499, 1500)).toBe("closing");
    expect(ridePhase(750, 1500)).toBe("moving");
    expect(ridePhase(1100, 1500)).toBe("opening");
    expect(ridePhase(1500, 1500)).toBe("done");
    expect(ridePhase(0, 0)).toBe("done");
  });
});

describe("riding the lift (#269)", () => {
  test("the level changes half way through the ride and the rider steps out at its landing", () => {
    publish();
    usePlayerStore.getState().spawnAt({ x: 5, z: 5, heading: 0 }, "compound");
    const t = timers();
    expect(rideLift("lv-octo", { style: "doors", schedule: t.schedule })).toBe("riding");
    expect(t.delays()).toEqual([RIDE_MS.doors / 2, RIDE_MS.doors]);
    // Doors closing: still on the level the ride began on.
    expect(useLiftStore.getState().ride).toMatchObject({
      from: LOBBY_LEVEL_ID,
      to: "lv-octo",
      style: "doors",
      arrived: false,
    });
    expect(useLevelStore.getState().levelId).toBe(LOBBY_LEVEL_ID);
    expect(usePlayerStore.getState().x).toBe(5);
    // A second call during the ride does nothing.
    expect(rideLift(LOBBY_LEVEL_ID, { style: "doors", schedule: t.schedule })).toBe("busy");
    t.fire(RIDE_MS.doors / 2);
    expect(useLevelStore.getState().levelId).toBe("lv-octo");
    expect(useLiftStore.getState().ride?.arrived).toBe(true);
    const world = useCompoundStore.getState().world;
    const lift = world ? liftOf(world) : null;
    if (!lift) throw new Error("no lift");
    expect(lift.room.kind).toBe("landing");
    const p = usePlayerStore.getState();
    expect({ x: p.x, z: p.z, heading: p.heading }).toEqual(lift.stand);
    t.fire(RIDE_MS.doors);
    expect(useLiftStore.getState()).toMatchObject({ ride: null, arrivedAt: "lv-octo" });
  });

  test("reduced motion: no ride, the level changes at once", () => {
    publish();
    usePlayerStore.getState().spawnAt({ x: 5, z: 5, heading: 0 }, "compound");
    const t = timers();
    expect(rideLift("lv-octo", { style: "cut", schedule: t.schedule })).toBe("arrived");
    expect(t.delays()).toEqual([]);
    expect(useLiftStore.getState()).toMatchObject({ ride: null, arrivedAt: "lv-octo" });
    expect(useLevelStore.getState().levelId).toBe("lv-octo");
  });

  test("not to the level one is on, nor to a level that is not published, nor before spawning", () => {
    publish();
    const t = timers();
    expect(rideLift("lv-octo", { style: "doors", schedule: t.schedule })).toBe("unknown");
    usePlayerStore.getState().spawnAt({ x: 5, z: 5, heading: 0 }, "compound");
    expect(rideLift(LOBBY_LEVEL_ID, { style: "doors", schedule: t.schedule })).toBe("here");
    // A level this viewer cannot reach is absent from the state: it cannot be ridden to by id.
    expect(rideLift("lv-secret", { style: "doors", schedule: t.schedule })).toBe("unknown");
    expect(rideLift("lv-secret", { style: "cut", schedule: t.schedule })).toBe("unknown");
    expect(t.delays()).toEqual([]);
    expect(useLiftStore.getState().ride).toBeNull();
    expect(useLevelStore.getState().levelId).toBe(LOBBY_LEVEL_ID);
  });

  test("a level that goes away during the ride: the doors open where it began", () => {
    publish();
    usePlayerStore.getState().spawnAt({ x: 5, z: 5, heading: 0 }, "compound");
    const t = timers();
    let lost = 0;
    rideLift("lv-octo", { style: "fade", schedule: t.schedule, onLost: () => lost++ });
    publish(LEVELS.filter((l) => l.levelId !== "lv-octo"));
    t.fire(RIDE_MS.fade / 2);
    expect(lost).toBe(1);
    expect(useLevelStore.getState().levelId).toBe(LOBBY_LEVEL_ID);
    expect(usePlayerStore.getState().x).toBe(5);
    t.fire(RIDE_MS.fade);
    expect(useLiftStore.getState()).toMatchObject({ ride: null, arrivedAt: null });
  });
});
