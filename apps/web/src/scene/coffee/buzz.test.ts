import { afterEach, describe, expect, test } from "bun:test";
import {
  BUZZ_MS,
  BUZZ_SPEED_BOOST,
  type BuildingState,
  buzzSpeedBoost,
  COFFEE_REACH,
  JITTER_CUPS,
  MAX_CUPS,
} from "@regulus/protocol";
import { findPath } from "@regulus/room-layout";
import { useBuildingStore } from "../../state/building.ts";
import { createHotkeyRegistry, DEFAULT_HOTKEYS } from "../../ui/hotkeys/registry.ts";
import { compoundNavGrid, lobbySpawn } from "../compound/navigation.ts";
import { testState, testWorld } from "../compound/testing.ts";
import { compoundWorld } from "../compound/world.ts";
import {
  gaitForSpeed,
  RUN_GAIT_ABOVE,
  selectSpeed,
  setSpeedBoost,
  speedBoost,
  WALK_GAIT_BELOW,
} from "../movement/gait.ts";
import { RUN_SPEED, WALK_SPEED } from "../movement/kinematics.ts";
import {
  buzzBadge,
  buzzMeter,
  coffeeSpotOf,
  JITTER_METRES,
  JITTER_YAW,
  jitterOffset,
  jitterSeed,
  selectSelfBuzz,
  shakes,
} from "./buzz.ts";
import { coffeeInReach, cupMessage } from "./CoffeeMachine.tsx";

afterEach(() => setSpeedBoost(1));

describe("the coffee machine in the world", () => {
  const world = testWorld([], []);
  const spot = coffeeSpotOf(world);
  const grid = compoundNavGrid(world);

  test("stands in the break room, and the drinker's spot is open floor reachable from the lobby", () => {
    if (!spot) throw new Error("no coffee machine on the lobby level");
    const room = world.rooms.find((r) => r.kind === "break_room");
    if (!room) throw new Error("no break room");
    const inside = (p: { x: number; z: number }) =>
      p.x > room.origin.x &&
      p.x < room.origin.x + room.size.w &&
      p.z > room.origin.z &&
      p.z < room.origin.z + room.size.d;
    expect(inside(spot.stand)).toBe(true);
    expect(inside({ x: spot.rect.x + spot.rect.w, z: spot.rect.z + spot.rect.d })).toBe(true);
    expect(grid.isWalkable(spot.stand.x, spot.stand.z)).toBe(true);
    // The machine itself is furniture: nobody walks through it.
    expect(grid.isWalkable(spot.rect.x + spot.rect.w / 2, spot.rect.z + spot.rect.d / 2)).toBe(
      false,
    );
    const spawn = lobbySpawn(world);
    const path = findPath(
      grid,
      grid.worldToCell(spawn.x, spawn.z),
      grid.worldToCell(spot.stand.x, spot.stand.z),
    );
    expect(path).not.toBeNull();
    expect(coffeeInReach(spot.stand, spot.stand)).toBe(true);
    expect(
      coffeeInReach(spot.stand, { x: spot.stand.x - COFFEE_REACH - 0.01, z: spot.stand.z }),
    ).toBe(false);
    expect(coffeeInReach(null, spot.stand)).toBe(false);
  });

  test("a level without a break room has no machine", () => {
    const state = testState([], 48, { levelId: "lv-octo", landing: true });
    const landing = compoundWorld(state, new Set(), "lv-octo");
    if (!landing) throw new Error("no world");
    expect(landing.rooms.some((r) => r.kind === "landing")).toBe(true);
    expect(coffeeSpotOf(landing)).toBeNull();
  });
});

describe("the speed boost", () => {
  test("a buzz makes walking and running faster by the buzz's factor, and nothing else does", () => {
    setSpeedBoost(buzzSpeedBoost({ cups: 1 }));
    expect(speedBoost()).toBe(BUZZ_SPEED_BOOST);
    expect(selectSpeed({ shift: false, pathRun: false })).toBeCloseTo(
      WALK_SPEED * BUZZ_SPEED_BOOST,
    );
    expect(selectSpeed({ shift: true, pathRun: false })).toBeCloseTo(RUN_SPEED * BUZZ_SPEED_BOOST);
    expect(selectSpeed({ shift: false, pathRun: true })).toBeCloseTo(RUN_SPEED * BUZZ_SPEED_BOOST);
    // More cups are not more speed.
    expect(buzzSpeedBoost({ cups: MAX_CUPS })).toBe(BUZZ_SPEED_BOOST);
    setSpeedBoost(buzzSpeedBoost({ cups: 0 }));
    expect(selectSpeed({ shift: false, pathRun: false })).toBe(WALK_SPEED);
    expect(buzzSpeedBoost(null)).toBe(1);
  });

  test("the factor cannot be set above the buzz's, below 1 or to nonsense", () => {
    setSpeedBoost(10);
    expect(speedBoost()).toBe(BUZZ_SPEED_BOOST);
    setSpeedBoost(0.2);
    expect(speedBoost()).toBe(1);
    setSpeedBoost(Number.NaN);
    expect(speedBoost()).toBe(1);
    setSpeedBoost(Number.POSITIVE_INFINITY);
    expect(speedBoost()).toBe(1);
  });

  test("a buzzed walk still reads as a walk and a buzzed run as a run for those watching", () => {
    const walk = WALK_SPEED * BUZZ_SPEED_BOOST;
    expect(walk).toBeLessThan(WALK_GAIT_BELOW);
    expect(gaitForSpeed(walk, "run")).toBe("walk");
    expect(RUN_SPEED * BUZZ_SPEED_BOOST).toBeGreaterThan(RUN_GAIT_ABOVE);
  });
});

describe("the buzz meter", () => {
  test("nothing without a buzz", () => {
    expect(buzzMeter(null, 0)).toBeNull();
    expect(buzzMeter({ cups: 0, buzzUntil: 0 }, 0)).toBeNull();
  });

  test("cups, seconds left and the bar run down with the server's clock", () => {
    const until = 1_000_000;
    expect(buzzMeter({ cups: 1, buzzUntil: until }, until - BUZZ_MS)).toEqual({
      cups: 1,
      seconds: 60,
      fraction: 1,
      jitters: false,
      boostPercent: 25,
    });
    expect(buzzMeter({ cups: 2, buzzUntil: until }, until - 14_200)).toMatchObject({
      cups: 2,
      seconds: 15,
      jitters: false,
    });
    expect(buzzMeter({ cups: 2, buzzUntil: until }, until - 15_000)?.fraction).toBeCloseTo(0.25);
    // A clock ahead or behind never shows more than a full bar or less than an empty one.
    expect(buzzMeter({ cups: 1, buzzUntil: until }, until - 2 * BUZZ_MS)?.fraction).toBe(1);
    expect(buzzMeter({ cups: 1, buzzUntil: until }, until + 5000)).toMatchObject({
      seconds: 0,
      fraction: 0,
    });
  });

  test("the third cup is the jitters", () => {
    expect(buzzMeter({ cups: JITTER_CUPS - 1, buzzUntil: 10 }, 0)?.jitters).toBe(false);
    expect(buzzMeter({ cups: JITTER_CUPS, buzzUntil: 10 }, 0)?.jitters).toBe(true);
  });

  test("the player's own buzz is read from their own presence", () => {
    const human = (cups: number) => ({ cups, buzzUntil: cups * 100 });
    useBuildingStore.setState({
      sessionId: "me",
      state: { humans: { me: human(2), you: human(4) } } as unknown as BuildingState,
    });
    expect(selectSelfBuzz(useBuildingStore.getState())).toEqual({ cups: 2, buzzUntil: 200 });
    useBuildingStore.setState({ sessionId: "gone" });
    expect(selectSelfBuzz(useBuildingStore.getState())).toBeNull();
    useBuildingStore.getState().clear();
  });
});

describe("what others see", () => {
  test("a cup badge while buzzed, saying Jitters from the third cup", () => {
    expect(buzzBadge(0)).toBeNull();
    expect(buzzBadge(1)).toEqual({ icon: "☕", label: "1 cup" });
    expect(buzzBadge(2)).toEqual({ icon: "☕", label: "2 cups" });
    expect(buzzBadge(JITTER_CUPS)).toEqual({ icon: "☕", label: "Jitters" });
  });

  test("cup messages", () => {
    expect(cupMessage(1)).toBe("Coffee: you walk and run 25% faster for 60 s.");
    expect(cupMessage(JITTER_CUPS)).toContain("jitters");
    expect(cupMessage(JITTER_CUPS + 1)).toContain("60 s more");
  });
});

describe("the jitters", () => {
  test("the body shakes from the third cup, never for a viewer with reduced motion", () => {
    expect(shakes(JITTER_CUPS - 1, false)).toBe(false);
    expect(shakes(JITTER_CUPS, false)).toBe(true);
    expect(shakes(MAX_CUPS, false)).toBe(true);
    expect(shakes(JITTER_CUPS, true)).toBe(false);
    expect(shakes(MAX_CUPS, true)).toBe(false);
  });

  test("the offset is small, bounded, moving, and a function of time alone", () => {
    let moved = 0;
    let last = jitterOffset(0);
    for (let i = 1; i <= 600; i++) {
      const o = jitterOffset(i / 60);
      expect(Math.abs(o.x)).toBeLessThanOrEqual(JITTER_METRES);
      expect(Math.abs(o.z)).toBeLessThanOrEqual(JITTER_METRES);
      expect(Math.abs(o.yaw)).toBeLessThanOrEqual(JITTER_YAW);
      moved += Math.hypot(o.x - last.x, o.z - last.z);
      last = o;
    }
    expect(moved).toBeGreaterThan(0.5);
    expect(jitterOffset(1.234, 0.5)).toEqual(jitterOffset(1.234, 0.5));
    // Small enough never to leave a nav cell or read as walking to anyone.
    expect(JITTER_METRES).toBeLessThan(0.05);
  });

  test("two people do not shake in step", () => {
    expect(jitterSeed("session-a")).not.toBe(jitterSeed("session-b"));
    expect(jitterOffset(2, jitterSeed("session-a"))).not.toEqual(
      jitterOffset(2, jitterSeed("session-b")),
    );
  });
});

describe("keys", () => {
  const registry = createHotkeyRegistry(DEFAULT_HOTKEYS);

  test("a cup is taken with the existing interact key, and no new key is bound", () => {
    expect(registry.resolve({ key: "e" })?.id).toBe("interact");
    expect(DEFAULT_HOTKEYS.some((b) => /coffee|buzz/i.test(b.id))).toBe(false);
  });

  test("E typed into a terminal, a text field or under an open window takes no cup", () => {
    // xterm's input is a textarea; the whiteboard and dialogs are overlays.
    expect(registry.resolve({ key: "e", editable: true })).toBeNull();
    expect(registry.resolve({ key: "e", overlayOpen: true })).toBeNull();
    expect(registry.resolve({ key: "e", ctrlKey: true })).toBeNull();
  });
});
