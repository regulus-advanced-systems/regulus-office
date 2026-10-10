import { describe, expect, test } from "bun:test";
import { breakRoomCoffeeMachine, COFFEE_STAND_OFF, coffeeMachineSpot } from "./coffee.ts";
import { computeCompoundLayout } from "./layout.ts";
import { defaultCompoundSpec, landingSpec, specialRooms } from "./special.ts";
import { compoundStateOf } from "./state.ts";

describe("the break room's coffee machine", () => {
  test("on the east wall, with the drinker standing in front of it", () => {
    const { rect, stand } = breakRoomCoffeeMachine(16, 16);
    expect(rect.x + rect.w).toBeLessThan(16);
    expect(rect.x + rect.w).toBeGreaterThan(15);
    expect(stand.x).toBeCloseTo(rect.x - COFFEE_STAND_OFF);
    expect(stand.z).toBeCloseTo(rect.z + rect.d / 2);
  });

  test("found in a published lobby level, in compound metres", () => {
    const spec = defaultCompoundSpec(48);
    const state = compoundStateOf(computeCompoundLayout(spec, []));
    const room = specialRooms(spec).find((r) => r.kind === "break_room");
    if (!room) throw new Error("no break room");
    const m = state.tileMetres;
    const local = breakRoomCoffeeMachine(room.rect.w * m, room.rect.d * m);
    expect(coffeeMachineSpot(state)).toEqual({
      rect: { ...local.rect, x: local.rect.x + room.rect.x * m, z: local.rect.z + room.rect.y * m },
      stand: { x: local.stand.x + room.rect.x * m, z: local.stand.z + room.rect.y * m },
    });
  });

  test("a level with only a lift landing has none", () => {
    const state = compoundStateOf(computeCompoundLayout(landingSpec(defaultCompoundSpec(48)), []));
    expect(coffeeMachineSpot(state)).toBeNull();
    expect(coffeeMachineSpot({ tileMetres: 2, specialRooms: [] })).toBeNull();
  });
});
