import { describe, expect, test } from "bun:test";
import { findWorldPath, HEADING } from "@regulus/room-layout";
import { jukeboxSpot } from "../../jukebox/spot.ts";
import { LAIR_DRAW_CALL_BUDGET, ROOM_TRIANGLE_BUDGET, sceneCost } from "../../lair/budget.ts";
import { PIECES } from "../../lair/kit.ts";
import { DOOR_OPEN_RADIUS } from "../Doors.tsx";
import { roomArt } from "../interiors.ts";
import { compoundNavGrid, lobbySpawn } from "../navigation.ts";
import { outsideLayout } from "../outside/layout.ts";
import { placeRoom } from "../placed.ts";
import { specialDressing } from "../special.ts";
import { rowPlacement, testState, testWorld } from "../testing.ts";
import { type CompoundWorld, compoundWorld, lobbyOf, travelPose } from "../world.ts";
import { fitName, indicatorLines, levelSignLines } from "./signs.ts";
import { atLift, LIFT_REACH, liftOf } from "./spot.ts";

const lobbyWorld = testWorld([]);
const level = testState([{ id: "apollo", placement: rowPlacement(4) }], 48, {
  levelId: "lv-a",
  landing: true,
});
const landingWorld = compoundWorld(level, new Set(["apollo"]), "lv-a") as CompoundWorld;

describe("the lift on every level (#269)", () => {
  test("stands at the same spot in the lobby and on a landing: one shaft", () => {
    const up = liftOf(lobbyWorld);
    const down = liftOf(landingWorld);
    if (!up || !down) throw new Error("no lift");
    expect(up.room.kind).toBe("lobby");
    expect(down.room.kind).toBe("landing");
    expect({ rect: down.rect, door: down.door, stand: down.stand }).toEqual({
      rect: up.rect,
      door: up.door,
      stand: up.stand,
    });
    expect(up.stand.heading).toBe(HEADING.west);
  });

  test.each([
    ["lobby", lobbyWorld],
    ["landing", landingWorld],
  ] as const)(
    "%s: the housing blocks, its doorstep is walkable from the corridors",
    (_n, world) => {
      const lift = liftOf(world);
      if (!lift) throw new Error("no lift");
      const grid = compoundNavGrid(world);
      const mid = { x: lift.rect.x + lift.rect.w / 2, z: lift.rect.z + lift.rect.d / 2 };
      expect(grid.isWalkable(mid.x, mid.z)).toBe(false);
      expect(grid.isWalkable(lift.stand.x, lift.stand.z)).toBe(true);
      expect(findWorldPath(grid, travelPose(lift.room), lift.stand)).not.toBeNull();
      expect(findWorldPath(grid, lobbySpawn(world), lift.stand)).not.toBeNull();
      expect(atLift(lift, lift.stand)).toBe(true);
      expect(atLift(lift, { x: lift.stand.x - LIFT_REACH - 0.1, z: lift.stand.z })).toBe(false);
      // Standing there opens the lift's own sliding door.
      const art = roomArt(lift.room);
      expect(art.pieces.filter((p) => p.piece === "lift_shaft")).toHaveLength(1);
      const doors = placeRoom(lift.room).doors;
      const liftDoor = doors[doors.length - 1];
      if (!liftDoor) throw new Error("no lift door");
      expect(doors).toHaveLength(2);
      expect(
        Math.hypot(liftDoor.position[0] - lift.stand.x, liftDoor.position[2] - lift.stand.z),
      ).toBeLessThan(DOOR_OPEN_RADIUS);
      expect(liftDoor.span ?? 1).toBe(1);
    },
  );

  test("in the lobby it is clear of the jukebox's spot, so E means one thing at each", () => {
    const lift = liftOf(lobbyWorld);
    const jukebox = jukeboxSpot(lobbyWorld);
    if (!lift || !jukebox) throw new Error("missing");
    expect(
      Math.hypot(jukebox.stand.x - lift.stand.x, jukebox.stand.z - lift.stand.z),
    ).toBeGreaterThan(LIFT_REACH + 1.8);
  });
});

describe("a level's landing is not a copy of the lobby (#269)", () => {
  const lobby = lobbyOf(lobbyWorld);
  if (!lobby) throw new Error("no lobby");
  const { w, d } = lobby.size;
  const hall = specialDressing("landing", w, d);
  const reception = specialDressing("lobby", w, d);

  test("it has the lift, a waiting nook and supplies; no reception, jukebox, TV, whiteboard or usage wall", () => {
    const models: string[] = hall.furniture.map((f) => f.model);
    for (const lobbyOnly of ["reception_desk", "jukebox", "couch"])
      expect(models).not.toContain(lobbyOnly);
    expect([hall.tv, hall.whiteboard, hall.usage]).toEqual([undefined, undefined, undefined]);
    expect(models.filter((m) => m === "armchair")).toHaveLength(2);
    for (const own of ["console", "lockers", "crate_stack", "barrel", "bench", "plant"])
      expect(models).toContain(own);
    expect(hall.lift).toEqual(reception.lift);
    expect(hall.levelSign).toBeDefined();
    expect(reception.levelSign).toBeUndefined();
    expect(reception.furniture.map((f) => f.model)).toContain("jukebox");
  });

  test.each([
    ["landing", hall],
    ["lobby", reception],
  ] as const)(
    "%s: nothing stands in the lift, in its doorway or outside the room",
    (_n, dressing) => {
      const lift = dressing.lift;
      if (!lift) throw new Error("no lift");
      const overlap = (a: typeof lift.rect, b: typeof lift.rect) =>
        a.x < b.x + b.w && b.x < a.x + a.w && a.z < b.z + b.d && b.z < a.z + a.d;
      // The housing and a strip in front of the door for stepping out.
      const doorstep = { x: lift.rect.x - 2.2, z: lift.rect.z + 0.4, w: 2.2, d: lift.rect.d - 0.8 };
      const blockers = [
        ...dressing.furniture.map((f) => f.rect),
        ...(dressing.tv ? [dressing.tv.rect] : []),
      ];
      for (const rect of blockers) {
        expect(overlap(rect, lift.rect), JSON.stringify(rect)).toBe(false);
        expect(overlap(rect, doorstep), JSON.stringify(rect)).toBe(false);
        expect(rect.x >= 0 && rect.z >= 0 && rect.x + rect.w <= w && rect.z + rect.d <= d).toBe(
          true,
        );
      }
      // The landing's own furniture does not overlap itself either (the lobby's is #186's).
      if (dressing !== hall) return;
      for (let i = 0; i < blockers.length; i++)
        for (let j = i + 1; j < blockers.length; j++)
          expect(
            overlap(blockers[i] as typeof lift.rect, blockers[j] as typeof lift.rect),
            `${i}/${j}`,
          ).toBe(false);
    },
  );

  test("a level other than the lobby level has no blast door, beach or mountain face", () => {
    expect(outsideLayout(lobbyWorld)).not.toBeNull();
    expect(outsideLayout(landingWorld)).toBeNull();
    expect(landingWorld.rooms.map((r) => r.kind)).toEqual(["landing", "project"]);
    expect(jukeboxSpot(landingWorld)).toBeNull();
    // Its south wall is whole: no gap where the lobby has its blast door.
    const south = (world: CompoundWorld) => {
      const room = world.rooms[0];
      if (!room) throw new Error("no room");
      return roomArt(room).pieces.filter(
        (p) =>
          p.position[2] > room.size.d &&
          p.piece.startsWith("wall_") &&
          p.piece !== "wall_pillar" &&
          p.piece !== "wall_trim",
      ).length;
    };
    expect(south(landingWorld)).toBe(south(lobbyWorld) + 4);
  });

  test("the landing and the lift stay inside the kit's budgets (SPEC §11)", () => {
    const room = landingWorld.rooms[0];
    if (!room) throw new Error("no landing");
    const cost = sceneCost(roomArt(room).pieces);
    expect(cost.triangles).toBeLessThanOrEqual(ROOM_TRIANGLE_BUDGET);
    expect(cost.drawCalls).toBeLessThanOrEqual(LAIR_DRAW_CALL_BUDGET);
    expect(PIECES.lift_shaft.budget).toBeLessThanOrEqual(1000);
  });
});

describe("the lift's lettering (#269)", () => {
  const label = {
    mark: "S2",
    title: "Regulus Advanced Systems",
    caption: "Sublevel 2 · GitHub organisation",
  };

  test("the indicator shows the level's mark and name", () => {
    expect(indicatorLines(label)).toEqual({
      mark: "S2",
      top: "LIFT",
      name: "REGULUS ADVANCED SYSTEMS",
    });
    expect(indicatorLines({ ...label, title: "x".repeat(40) }).name).toHaveLength(26);
  });

  test("a landing's wall sign says how deep it is and whose level it is", () => {
    expect(levelSignLines(label)).toEqual({ top: "SUBLEVEL 2", name: "REGULUS ADVANCED SYSTEMS" });
    expect(fitName("short", 10)).toBe("short");
    expect(fitName("0123456789ABC", 10)).toBe("012345678…");
  });
});
