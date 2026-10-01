import { afterEach, describe, expect, test } from "bun:test";
import { BLAST_DOOR_CLOSED } from "@regulus/protocol";
import { useBuildingStore } from "../../../state/building.ts";
import { rowPlacement, testWorld } from "../testing.ts";
import { buttonInReach } from "./buttons.tsx";
import {
  ALARM_TAIL_S,
  alarmOn,
  currentDoor,
  DOOR_TRAVEL_S,
  DOOR_UNLOCK_S,
  leafOffset,
  leavesMoving,
  SHUT,
  stepLeaves,
  useDoorOverride,
} from "./doorState.ts";
import { outsideLayout } from "./layout.ts";

function run(m: typeof SHUT, open: boolean, seconds: number, dt = 1 / 30) {
  let s = m;
  for (let t = 0; t < seconds; t += dt) s = stepLeaves(s, open, dt);
  return s;
}

afterEach(() => {
  useDoorOverride.getState().set({ phase: null });
  useBuildingStore.getState().clear();
});

describe("the heavy leaves", () => {
  test("opening: the bolts draw first (nothing slides), then the leaves travel all the way", () => {
    const unlocking = run(SHUT, true, DOOR_UNLOCK_S * 0.8);
    expect(unlocking.travel).toBe(0);
    expect(unlocking.unlock).toBeGreaterThan(0);
    expect(leavesMoving(unlocking)).toBe(true);
    const half = run(SHUT, true, DOOR_UNLOCK_S + DOOR_TRAVEL_S / 2);
    expect(half.travel).toBeGreaterThan(0.4);
    expect(half.travel).toBeLessThan(0.6);
    const open = run(SHUT, true, DOOR_UNLOCK_S + DOOR_TRAVEL_S + 0.2);
    expect(open.travel).toBe(1);
    expect(leavesMoving(open)).toBe(false);
  });

  test("closing slides straight back; even at 3 fps it ends exactly shut", () => {
    const open = { travel: 1, unlock: 0, open: true };
    const shut = run(open, false, DOOR_TRAVEL_S + 0.4, 1 / 3);
    expect(shut.travel).toBe(0);
    expect(leavesMoving(shut)).toBe(false);
  });

  test("the slide eases in and out, from 0 to 1", () => {
    expect(leafOffset(0)).toBe(0);
    expect(leafOffset(1)).toBe(1);
    expect(leafOffset(0.1)).toBeLessThan(0.1);
    expect(leafOffset(0.5)).toBeCloseTo(0.5, 6);
  });

  test("the alarm runs while open, while the leaves move and briefly after they shut", () => {
    expect(alarmOn("open", { travel: 1, unlock: 0, open: true }, 99)).toBe(true);
    expect(alarmOn("closing", { travel: 1, unlock: 0, open: true }, 99)).toBe(true);
    expect(alarmOn("closed", { travel: 0.5, unlock: 0, open: false }, 0)).toBe(true);
    expect(alarmOn("closed", SHUT, ALARM_TAIL_S / 2)).toBe(true);
    expect(alarmOn("closed", SHUT, ALARM_TAIL_S + 0.1)).toBe(false);
    expect(alarmOn("closed", SHUT, 99, true)).toBe(true);
  });
});

describe("the shared door on the client", () => {
  test("follows the building room's state; the dev harness can force a phase", () => {
    expect(currentDoor()).toEqual(BLAST_DOOR_CLOSED);
    useBuildingStore.setState({
      state: { blastDoor: { ...BLAST_DOOR_CLOSED, phase: "open", presses: 2 } } as never,
    });
    expect(currentDoor().phase).toBe("open");
    useDoorOverride.getState().set({ phase: "closing" });
    expect(currentDoor()).toMatchObject({ phase: "closing", presses: 2 });
  });

  test("E reaches a button only from its stand point", () => {
    const layout = outsideLayout(testWorld([{ id: "a", placement: rowPlacement(4) }]));
    if (!layout) throw new Error("no outside");
    const [inside, outside] = layout.buttons;
    expect(buttonInReach(layout, inside.stand)?.side).toBe("inside");
    expect(buttonInReach(layout, { x: outside.stand.x + 0.5, z: outside.stand.z })?.side).toBe(
      "outside",
    );
    expect(buttonInReach(layout, { x: layout.door.centre, z: layout.edgeZ - 3 })).toBeNull();
  });
});
