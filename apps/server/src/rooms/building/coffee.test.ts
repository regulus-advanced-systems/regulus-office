import { describe, expect, test } from "bun:test";
import {
  BUZZ_MS,
  COFFEE_COOLDOWN_MS,
  COFFEE_SERVER_REACH,
  type CompoundState,
  EMPTY_COMPOUND,
  JITTER_CUPS,
  LOBBY_LEVEL_ID,
  MAX_CUPS,
} from "@regulus/protocol";
import { coffeeMachineSpot } from "@regulus/room-layout";
import { createCoffeeMachine, type Drinker } from "./coffee.ts";

const compound: CompoundState = {
  ...EMPTY_COMPOUND,
  width: 64,
  depth: 64,
  specialRooms: [
    {
      kind: "break_room",
      gridX: 40,
      gridY: 56,
      width: 8,
      depth: 8,
      doorSide: "north",
      doorX: 43,
      doorY: 56,
    },
  ],
};
const spot = coffeeMachineSpot(compound);
if (!spot) throw new Error("no coffee machine in the test compound");

const at = (x: number, z: number, levelId = LOBBY_LEVEL_ID): Drinker => ({
  levelId,
  position: { x, z },
  cups: 0,
  buzzUntil: 0,
});

function setup() {
  let t = 1_000_000;
  const machine = createCoffeeMachine(() => t);
  return { machine, advance: (ms: number) => void (t += ms), now: () => t };
}

describe("coffee machine", () => {
  test("a cup at the machine starts a buzz of one minute", () => {
    const { machine, now } = setup();
    const human = at(spot.stand.x, spot.stand.z);
    expect(machine.drink("s1", human, compound)).toEqual({ ok: true, cups: 1 });
    expect(human).toMatchObject({ cups: 1, buzzUntil: now() + BUZZ_MS });
  });

  test("nobody gets a cup from across the room, from another level or without a break room", () => {
    const { machine } = setup();
    const far = at(spot.stand.x - COFFEE_SERVER_REACH - 0.1, spot.stand.z);
    const refusal = {
      ok: false as const,
      reason: "Walk up to the coffee machine in the break room.",
    };
    expect(machine.drink("s1", far, compound)).toEqual(refusal);
    expect(far.cups).toBe(0);
    // The same spot on another level is solid rock or somebody's room (#269).
    const below = at(spot.stand.x, spot.stand.z, "lv-octo");
    expect(machine.drink("s2", below, compound)).toEqual(refusal);
    expect(machine.drink("s3", at(spot.stand.x, spot.stand.z), EMPTY_COMPOUND)).toEqual(refusal);
    expect(machine.drink("s4", at(spot.stand.x, spot.stand.z), undefined)).toEqual(refusal);
  });

  test("the edge of the server's reach still counts (a pose in flight)", () => {
    const { machine } = setup();
    const edge = at(spot.stand.x - COFFEE_SERVER_REACH + 0.01, spot.stand.z);
    expect(machine.drink("s1", edge, compound).ok).toBe(true);
  });

  test("one cup at a time per person; someone else is not held up", () => {
    const { machine, advance } = setup();
    const human = at(spot.stand.x, spot.stand.z);
    expect(machine.drink("s1", human, compound).ok).toBe(true);
    advance(COFFEE_COOLDOWN_MS - 1);
    expect(machine.drink("s1", human, compound)).toEqual({
      ok: false,
      reason: "Finish that cup first.",
    });
    expect(human.cups).toBe(1);
    expect(machine.drink("s2", at(spot.stand.x, spot.stand.z), compound).ok).toBe(true);
    advance(1);
    expect(machine.drink("s1", human, compound)).toEqual({ ok: true, cups: 2 });
  });

  test("every cup starts the minute again; cups stop counting at the maximum", () => {
    const { machine, advance, now } = setup();
    const human = at(spot.stand.x, spot.stand.z);
    for (let cup = 1; cup <= MAX_CUPS + 2; cup++) {
      expect(machine.drink("s1", human, compound)).toEqual({
        ok: true,
        cups: Math.min(cup, MAX_CUPS),
      });
      expect(human.buzzUntil).toBe(now() + BUZZ_MS);
      advance(COFFEE_COOLDOWN_MS);
    }
    expect(MAX_CUPS).toBeGreaterThanOrEqual(JITTER_CUPS);
  });

  test("the sweep ends a buzz when its minute is up, and not before", () => {
    const { machine, advance } = setup();
    const human = at(spot.stand.x, spot.stand.z);
    const sober = at(0, 0);
    const humans = [human, sober];
    machine.drink("s1", human, compound);
    advance(BUZZ_MS - 1);
    machine.tick(humans);
    expect(human.cups).toBe(1);
    advance(1);
    machine.tick(humans);
    expect(human).toMatchObject({ cups: 0, buzzUntil: 0 });
    expect(sober).toMatchObject({ cups: 0, buzzUntil: 0 });
  });

  test("a leaver's cooldown is forgotten", () => {
    const { machine } = setup();
    const human = at(spot.stand.x, spot.stand.z);
    machine.drink("s1", human, compound);
    machine.forget("s1");
    expect(machine.drink("s1", human, compound)).toEqual({ ok: true, cups: 2 });
  });
});
