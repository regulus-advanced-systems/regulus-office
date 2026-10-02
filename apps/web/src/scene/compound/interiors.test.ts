import { describe, expect, test } from "bun:test";
import { LAIR_DRAW_CALL_BUDGET, ROOM_TRIANGLE_BUDGET, sceneCost } from "../lair/budget.ts";
import { PIECES } from "../lair/kit.ts";
import { structureLists } from "./CompoundStructure.tsx";
import { corridorChunks } from "./corridors.ts";
import { roomArt, roomLook } from "./interiors.ts";
import { placeRoom } from "./placed.ts";
import { rowPlacement, testWorld } from "./testing.ts";
import type { WorldRoom } from "./world.ts";

const world = testWorld(
  [
    { id: "open", placement: rowPlacement(4), deskCount: 3, decorStyle: "lab" },
    { id: "site", placement: rowPlacement(16), building: true },
    { id: "locked", placement: rowPlacement(28) },
  ],
  ["open", "site"],
);
const room = (id: string) => world.rooms.find((r) => r.id === id) as WorldRoom;
const inside = (r: WorldRoom, x: number, z: number) =>
  x > 0 && z > 0 && x < r.size.w && z < r.size.d;
const FURNITURE = new Set(["furniture", "clutter"]);

describe("room art per viewer (#186)", () => {
  test("open rooms get their generated interior; others do not", () => {
    expect(world.rooms.map((r) => [r.id, roomLook(r)])).toEqual([
      ["lobby", "special"],
      ["conference", "special"],
      ["break_room", "special"],
      ["open", "open"],
      ["site", "building"],
      ["locked", "locked"],
    ]);
    const open = roomArt(room("open"));
    const layout = open.layout;
    if (!layout) throw new Error("no interior");
    expect(layout.room.deskCount).toBe(3);
    expect(layout.room.decorStyle).toBe("lab");
    expect(open.obstacles.length).toBe(layout.obstacles.length);
    expect(open.laptops).toHaveLength(12);
    expect(open.laptopSeats).toEqual(
      layout.seats.filter((s) => s.kind === "desk").map((s) => s.id),
    );
    expect(open.looks.map((l) => l.look).sort()).toEqual([
      "board",
      "board",
      "clipboard",
      "gong",
      "whiteboard",
    ]);
  });

  test("a room the viewer may not enter shows nothing of its interior", () => {
    const locked = roomArt(room("locked"));
    const r = room("locked");
    const furniture = locked.pieces.filter(
      (p) => FURNITURE.has(PIECES[p.piece].category) && inside(r, p.position[0], p.position[2]),
    );
    expect(furniture).toEqual([]);
    expect(locked.layout).toBeNull();
    expect(locked.looks).toEqual([]);
    expect(locked.doors).toHaveLength(1);
  });

  test("a build site has scaffolding and only its back walls up", () => {
    const site = roomArt(room("site"));
    const kinds = new Set(site.pieces.map((p) => p.piece));
    for (const k of ["scaffold", "crate_stack", "work_light", "cable_drum"])
      expect(kinds.has(k as never)).toBe(true);
    const r = room("site");
    const walls = site.pieces.filter((p) => p.piece.startsWith("wall_rock"));
    for (const w of walls) expect(w.position[2] < 0 || w.position[0] < 0).toBe(true);
    expect(r.buildState).toBe("building");
  });

  test("special rooms are dressed inside their walls, clear of the door", () => {
    for (const kind of ["lobby", "conference", "break_room"]) {
      const r = room(kind);
      const art = roomArt(r);
      expect(art.dressing?.furniture.length).toBeGreaterThan(5);
      const door = { x: r.door.x * world.tileMetres - r.origin.x, z: 0 };
      for (const o of art.obstacles) {
        expect(o.x).toBeGreaterThanOrEqual(0);
        expect(o.z).toBeGreaterThanOrEqual(0);
        expect(o.x + o.w).toBeLessThanOrEqual(r.size.w);
        expect(o.z + o.d).toBeLessThanOrEqual(r.size.d);
        // Nothing within 2 m of the doorway (north wall, 4 m wide).
        const nearDoor = o.z < 2 && o.x + o.w > door.x - 0.5 && o.x < door.x + 4.5;
        expect(nearDoor, `${kind} ${JSON.stringify(o)}`).toBe(false);
      }
    }
    // The lobby's blast door replaces the middle of its south wall.
    const lobby = room("lobby");
    const south = roomArt(lobby).pieces.filter(
      (p) =>
        p.piece.startsWith("wall_") &&
        p.position[2] > lobby.size.d &&
        Math.abs(p.position[0] - lobby.size.w / 2) < 3,
    );
    expect(south.filter((p) => p.piece !== "wall_pillar")).toEqual([]);
  });

  test("art is cached per room and setting", () => {
    expect(roomArt(room("open"))).toBe(roomArt(room("open")));
    const bigger = { ...room("open"), deskCount: 4 };
    expect(roomArt(bigger)).not.toBe(roomArt(room("open")));
  });
});

describe("draw budget of the whole compound on screen (#183, #186, SPEC §11)", () => {
  test("every room and corridor at once stays inside the lair kit's draw-call budget", () => {
    const rooms = world.rooms.map(placeRoom);
    const chunks = corridorChunks({
      width: world.width,
      depth: world.depth,
      corridors: world.corridors,
      rooms: world.rooms.map((r) => r.rect),
    });
    const lists = structureLists(
      rooms,
      chunks,
      new Set(world.rooms.map((r) => r.id)),
      new Set(chunks.map((c) => c.key)),
      new Map([["open", new Set(["d1s1"])]]),
    );
    const cost = sceneCost(lists.pieces);
    expect(cost.drawCalls).toBeLessThanOrEqual(LAIR_DRAW_CALL_BUDGET);
    // A furnished room stays within the per-room triangle budget.
    expect(sceneCost(placeRoom(room("open")).pieces).triangles).toBeLessThan(ROOM_TRIANGLE_BUDGET);
    // The joined room draws its henchman's laptop itself; free desks keep the kit laptop.
    const laptops = lists.pieces.filter((p) => p.piece === "laptop");
    expect(laptops).toHaveLength(11);
  });
});
