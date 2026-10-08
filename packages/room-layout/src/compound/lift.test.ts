import { describe, expect, test } from "bun:test";
import { OUTSIDE_STRIP_TILES } from "@regulus/protocol";
import { HEADING } from "../geometry.ts";
import { computeCompoundLayout } from "./layout.ts";
import { LIFT_SIZE, liftSpot, liftSpotIn } from "./lift.ts";
import { buildCompoundNavGrid } from "./nav.ts";
import { specialRoomSeats } from "./seats.ts";
import { blastDoor, defaultCompoundSpec, landingSpec, specialRooms } from "./special.ts";
import { compoundNavInput } from "./state.ts";
import { checkPlacement } from "./validate.ts";

const spec = defaultCompoundSpec(64);
const landing = landingSpec(spec);

describe("a level other than the lobby level", () => {
  test("has the lift landing on the lobby's footprint as its only fixed room", () => {
    expect(specialRooms(spec).map((s) => s.kind)).toEqual(["lobby", "conference", "break_room"]);
    const rooms = specialRooms(landing);
    expect(rooms.map((s) => s.kind)).toEqual(["landing"]);
    expect(rooms[0]?.rect).toEqual(spec.lobby);
    expect(rooms[0]?.doorSide).toBe("north");
    expect(landingSpec(landing)).toBe(landing);
  });

  test("has no blast door and no beach; the lobby level keeps both", () => {
    expect(blastDoor(spec).width).toBeGreaterThan(0);
    expect(blastDoor(landing).width).toBe(0);
    expect(computeCompoundLayout(spec, []).outsideDepth).toBe(OUTSIDE_STRIP_TILES);
    const layout = computeCompoundLayout(landing, []);
    expect(layout.outsideDepth).toBe(0);
    expect(layout.unreachable).toEqual([]);
    const grid = buildCompoundNavGrid(compoundNavInput(layout), { blastDoorOpen: true });
    expect(grid.rows * grid.cellSize).toBe(spec.depth * 2);
  });

  test("a room may stand where the lobby level has its war room, and not on the landing", () => {
    const war = specialRooms(spec)[1]?.rect;
    if (!war) throw new Error("no war room");
    const there = { gridX: war.x, gridY: war.y, width: 8, depth: 8, doorSide: "north" } as const;
    expect(checkPlacement(spec, [], "a", there).ok).toBe(false);
    expect(checkPlacement(landing, [], "a", there).ok).toBe(true);
    const onLanding = { ...there, gridX: spec.lobby.x };
    const refused = checkPlacement(landing, [], "a", onLanding);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.conflicts).toContain("landing");
  });
});

describe("liftSpot", () => {
  const w = spec.lobby.w * 2;
  const d = spec.lobby.d * 2;
  const lift = liftSpot(w, d);

  test("stands against the east wall with its door facing west", () => {
    expect(lift.facing).toBe("west");
    expect(lift.rect.x + lift.rect.w).toBeCloseTo(w - 0.1, 5);
    expect(lift.rect.w).toBe(LIFT_SIZE.out);
    expect(lift.rect.d).toBe(LIFT_SIZE.along);
    expect(lift.rect.z).toBeGreaterThan(0);
    expect(lift.rect.z + lift.rect.d).toBeLessThan(d);
  });

  test("a rider steps out in front of the door, facing away from the lift", () => {
    expect(lift.stand.z).toBeCloseTo(lift.door.z, 5);
    expect(lift.stand.x).toBeLessThan(lift.rect.x - 1);
    expect(lift.stand.heading).toBe(HEADING.west);
  });

  test("is clear of every seat of the lobby and of the landing", () => {
    for (const kind of ["lobby", "landing"] as const) {
      for (const s of specialRoomSeats(kind, w, d)) {
        const inside =
          s.pose.x > lift.rect.x - 0.5 &&
          s.pose.z > lift.rect.z - 0.5 &&
          s.pose.z < lift.rect.z + lift.rect.d + 0.5;
        expect(inside).toBe(false);
        expect(Math.hypot(s.pose.x - lift.stand.x, s.pose.z - lift.stand.z)).toBeGreaterThan(1.5);
      }
    }
  });

  test("is at the same compound spot on every level (one shaft)", () => {
    const lobby = specialRooms(spec)[0]?.rect;
    const hall = specialRooms(landing)[0]?.rect;
    if (!lobby || !hall) throw new Error("no arrival room");
    expect(liftSpotIn(hall)).toEqual(liftSpotIn(lobby));
    expect(liftSpotIn(lobby).door.x).toBeCloseTo(lobby.x * 2 + lift.door.x, 5);
  });
});
