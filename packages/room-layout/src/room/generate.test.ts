import { describe, expect, test } from "bun:test";
import {
  DECOR_STYLES,
  type DecorStyle,
  DOOR_WIDTH_TILES,
  ROOM_MAX_TILES,
  ROOM_MIN_TILES,
} from "@regulus/protocol";
import { doorApproach, doorStart } from "../compound/grid.ts";
import { headingToward } from "../geometry.ts";
import { buildNavGrid } from "../nav-grid.ts";
import { interactables, rectSpanOnWall, wallById } from "../query.ts";
import { COMPASS_DIRECTIONS, WALL_ANCHOR_KINDS } from "../types.ts";
import { BOARD_LIKE, GONG_CLEARANCE } from "./anchors.ts";
import { ROOM_MIN_FREE } from "./constants.ts";
import { generateRoom, maxDeskCount, RoomGenerationError } from "./generate.ts";
import { roomProblems } from "./measure.ts";
import { DOCS_SHELF_ID, DOCS_SHELF_MODEL, SHELF_CLEARANCE } from "./props.ts";
import { roomDeskSeatIds } from "./seat-ids.ts";
import type { RoomLayout } from "./types.ts";

const SIZES: Array<[number, number]> = [];
for (let w = ROOM_MIN_TILES; w <= ROOM_MAX_TILES; w++)
  for (let d = ROOM_MIN_TILES; d <= ROOM_MAX_TILES; d++) SIZES.push([w, d]);

/** Anchor kinds a project room hangs (the TV belongs to the lobby). */
const ROOM_ANCHOR_KINDS = WALL_ANCHOR_KINDS.filter((k) => k !== "tv");

const room = (w: number, d: number, side: string, k: number, style: DecorStyle) =>
  generateRoom({
    width: w,
    depth: d,
    doorSide: side as (typeof COMPASS_DIRECTIONS)[number],
    deskCount: k,
    decorStyle: style,
  });

/** Every check a generated room is held to, plus the anchor and cell-centre rules. */
function check(l: RoomLayout): string[] {
  const problems = roomProblems(l, ROOM_MIN_FREE);
  const kinds = new Set(l.wallAnchors.map((a) => a.kind));
  for (const kind of ROOM_ANCHOR_KINDS) if (!kinds.has(kind)) problems.push(`no ${kind}`);
  const stands = interactables(l);
  const gong = stands.find((i) => i.kind === "gong");
  for (const b of stands.filter((i) => BOARD_LIKE.has(i.kind as never))) {
    if (
      gong &&
      Math.hypot(b.standAt.x - gong.standAt.x, b.standAt.z - gong.standAt.z) <= GONG_CLEARANCE
    )
      problems.push(`${b.id} answers E at the gong`);
  }
  const grid = buildNavGrid(l);
  for (const p of [
    ...l.seats.map((s) => ({ id: s.id, ...s.pose })),
    ...stands.map((i) => ({ id: i.id, ...i.standAt })),
  ]) {
    const c = grid.cellToWorld(grid.worldToCell(p.x, p.z));
    if (Math.abs(c.x - p.x) > 1e-9 || Math.abs(c.z - p.z) > 1e-9)
      problems.push(`${p.id} is off its cell centre`);
  }
  problems.push(...shelfProblems(l));
  return problems;
}

/**
 * The docs bookshelf (#264): one in every room, usable (a stand point), its
 * `E` clear of every board's, the gong's and the door's, and never standing
 * under wall decor. That it blocks no desk, board or lane is `roomProblems`.
 */
function shelfProblems(l: RoomLayout): string[] {
  const shelves = l.obstacles.filter((o) => o.id === DOCS_SHELF_ID);
  const shelf = shelves[0];
  if (shelves.length !== 1 || !shelf?.standAt) return [`${shelves.length} usable docs shelves`];
  const problems: string[] = [];
  const stand = shelf.standAt;
  if (shelf.kind !== "bookshelf" || l.room.models[shelf.id] !== DOCS_SHELF_MODEL)
    problems.push("the docs shelf is not drawn as the bookshelf");
  for (const other of interactables(l)) {
    if (other.id === shelf.id) continue;
    const gap = Math.hypot(other.standAt.x - stand.x, other.standAt.z - stand.z);
    if (gap < SHELF_CLEARANCE - 1e-9)
      problems.push(`the docs shelf answers E at ${other.id} (${gap.toFixed(2)} m)`);
  }
  // In front of the shelf, within arm's reach of it, facing it.
  const centre = { x: shelf.rect.x + shelf.rect.w / 2, z: shelf.rect.z + shelf.rect.d / 2 };
  const off = Math.abs(stand.heading - headingToward(stand, centre)) % (2 * Math.PI);
  if (
    Math.hypot(centre.x - stand.x, centre.z - stand.z) > 0.6 ||
    Math.min(off, 2 * Math.PI - off) > 1e-6
  )
    problems.push("the docs shelf's stand point does not face it");
  for (const item of l.wallDecor) {
    const wall = wallById(l, item.wallId);
    if (!wall) continue;
    const near = Math.abs(
      wall.from.x === wall.to.x ? centre.x - wall.from.x : centre.z - wall.from.z,
    );
    const span = rectSpanOnWall(wall, shelf.rect);
    if (near < 0.5 && item.t + item.w / 2 > span.start && item.t - item.w / 2 < span.end)
      problems.push(`the docs shelf stands under ${item.id}`);
  }
  return problems;
}

describe("generateRoom: every size, door side, style and desk count", () => {
  test.each(SIZES)("%i x %i tiles", (w, d) => {
    const max = maxDeskCount(w, d);
    const failures: string[] = [];
    for (const side of COMPASS_DIRECTIONS) {
      for (const style of DECOR_STYLES) {
        for (let k = 1; k <= max; k++) {
          const problems = check(room(w, d, side, k, style));
          if (problems.length > 0) failures.push(`${side} ${style} ${k}: ${problems.join("; ")}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });
});

describe("desk count and seat ids", () => {
  test.each(SIZES)("%i x %i: growth never renumbers or moves a seat", (w, d) => {
    const max = maxDeskCount(w, d);
    for (const side of COMPASS_DIRECTIONS) {
      let before: RoomLayout | undefined;
      for (let k = 1; k <= max; k++) {
        const l = room(w, d, side, k, "ops_room");
        const desk = l.seats.filter((s) => s.kind === "desk");
        expect(desk.map((s) => s.id)).toEqual(roomDeskSeatIds(k));
        expect(l.room.desks.map((x) => x.id)).toEqual(
          Array.from({ length: k }, (_, i) => `d${i + 1}`),
        );
        if (before) {
          for (const seat of before.seats.filter((s) => s.kind === "desk"))
            expect(l.seats.find((s) => s.id === seat.id)?.pose).toEqual(seat.pose);
        }
        before = l;
      }
    }
  });

  test("capacity: 4x4 holds the vanilla desk, 12x12 the most, and a bigger room never fits fewer", () => {
    expect(maxDeskCount(4, 4)).toBe(1);
    expect(maxDeskCount(12, 12)).toBeGreaterThanOrEqual(12);
    for (const [w, d] of SIZES) {
      if (w < ROOM_MAX_TILES)
        expect(maxDeskCount(w + 1, d)).toBeGreaterThanOrEqual(maxDeskCount(w, d));
      if (d < ROOM_MAX_TILES)
        expect(maxDeskCount(w, d + 1)).toBeGreaterThanOrEqual(maxDeskCount(w, d));
    }
  });

  test("one desk too many, a bad size, style or count is refused", () => {
    const max = maxDeskCount(6, 6);
    const codeOf = (f: () => unknown) => {
      try {
        f();
      } catch (err) {
        return err instanceof RoomGenerationError ? err.code : String(err);
      }
      return "ok";
    };
    expect(codeOf(() => room(6, 6, "south", max + 1, "lab"))).toBe("too_many_desks");
    expect(codeOf(() => room(3, 6, "south", 1, "lab"))).toBe("bad_size");
    expect(codeOf(() => room(13, 6, "south", 1, "lab"))).toBe("bad_size");
    expect(codeOf(() => room(6.5, 6, "south", 1, "lab"))).toBe("bad_size");
    expect(codeOf(() => room(6, 6, "up", 1, "lab"))).toBe("bad_door_side");
    expect(codeOf(() => room(6, 6, "south", 0, "lab"))).toBe("bad_desk_count");
    expect(codeOf(() => room(6, 6, "south", 1, "disco" as DecorStyle))).toBe("bad_decor_style");
  });
});

describe("vanilla start and decor styles", () => {
  test.each([...COMPASS_DIRECTIONS])(
    "a new room (door %s) is one desk, a cabinet, a plant and a lamp, and the docs bookshelf",
    (side) => {
      const l = room(8, 8, side, 1, "ops_room");
      expect(l.obstacles.map((o) => o.kind).sort()).toEqual([
        "bookshelf",
        "cabinet",
        "floor_lamp",
        "plant",
        "shared_table",
      ]);
      expect(l.seats.map((s) => s.id)).toEqual(["d1s1", "d1s2", "d1s3", "d1s4"]);
      expect(l.wallDecor).toEqual([]);
      expect(new Set(l.wallAnchors.map((a) => a.kind))).toEqual(new Set(ROOM_ANCHOR_KINDS));
    },
  );

  test("a growing room gets lived-in: more props, rugs, wall decor and a lounge nook", () => {
    const vanilla = room(10, 10, "south", 1, "lab");
    const busy = room(10, 10, "south", 5, "lab");
    expect(busy.obstacles.length - 5).toBeGreaterThan(vanilla.obstacles.length - 1 + 4);
    expect(busy.wallDecor.length).toBeGreaterThan(0);
    expect(busy.seats.filter((s) => s.kind === "couch")).toHaveLength(2);
    expect(busy.rugs.length).toBeGreaterThan(5);
    expect(busy.decor.length).toBeGreaterThanOrEqual(10);
  });

  test.each(SIZES.filter(([w, d]) => (w + d) % 3 === 0))(
    "%i x %i: styles change looks, never function",
    (w, d) => {
      for (const side of COMPASS_DIRECTIONS) {
        const k = maxDeskCount(w, d);
        const [first, ...rest] = DECOR_STYLES.map((s) => room(w, d, side, k, s));
        if (!first) throw new Error("no styles");
        const fn = (l: RoomLayout) => ({
          seats: l.seats,
          anchors: l.wallAnchors,
          walls: l.walls,
          elevator: l.elevator,
          spawn: l.spawn,
          desks: l.room.desks,
          interactables: interactables(l),
          footprints: l.obstacles.map((o) => o.rect),
        });
        for (const other of rest) expect(fn(other)).toEqual(fn(first));
        const looks = new Set(
          [first, ...rest].map((l) => JSON.stringify([l.room.materials, l.room.lighting.sky])),
        );
        expect(looks.size).toBe(DECOR_STYLES.length);
      }
    },
  );

  test("every piece has a model id, and lights follow desks and lamps", () => {
    const l = room(9, 9, "east", 6, "workshop");
    const ids = [
      ...l.obstacles.map((o) => o.id),
      ...l.decor.map((x) => x.id),
      ...l.wallDecor.map((x) => x.id),
      ...l.wallAnchors.map((x) => x.id),
      ...l.seats.map((x) => x.id),
    ];
    for (const id of ids) expect(l.room.models[id]).toMatch(/^lair\/[a-z_]+\/[a-z0-9_-]+$/);
    const lights = l.room.lighting.lights;
    expect(lights.filter((x) => x.kind === "pendant")).toHaveLength(6);
    expect(lights.filter((x) => x.kind === "lamp")).toHaveLength(
      l.obstacles.filter((o) => o.kind === "floor_lamp").length,
    );
    expect(lights.filter((x) => x.kind === "accent")).toHaveLength(1);
  });

  test.each(SIZES.filter(([w, d]) => w === d || w === 5))(
    "%i x %i: the door matches the compound's (#181) and faces the board wall",
    (w, d) => {
      for (const side of COMPASS_DIRECTIONS) {
        const l = room(w, d, side, 1, "war_room");
        const rect = { x: 0, y: 0, w, d };
        const start = doorStart(rect, side);
        const along = side === "north" || side === "south" ? start.x : start.y;
        expect(l.room.door).toMatchObject({
          wallId: "door",
          side,
          start: along * 2,
          end: (along + DOOR_WIDTH_TILES) * 2,
        });
        expect(l.walls.find((x) => x.id === "door")?.openings).toEqual([
          { kind: "door", t: 0, w: DOOR_WIDTH_TILES * 2 },
        ]);
        expect(l.spawn).toEqual(l.elevator.door);
        // The approach pose outside, mirrored through the door, is the spawn pose inside.
        const outside = doorApproach(rect, side);
        expect(l.spawn.heading).toBe(outside.heading);
        // The door's wall carries the room name; the wall facing it is full.
        expect(l.nameWallId).toBe(side);
        expect(l.walls.find((x) => x.id === side)?.height).toBe("stub");
        const opposite = { north: "south", south: "north", east: "west", west: "east" }[side];
        expect(l.walls.find((x) => x.id === opposite)?.height).toBe("full");
        expect(l.wallAnchors.every((a) => a.wallId !== side && a.wallId !== `${side}-2`)).toBe(
          true,
        );
      }
    },
  );
});
