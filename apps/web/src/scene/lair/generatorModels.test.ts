import { describe, expect, test } from "bun:test";
import { DECOR_STYLES, ROOM_MAX_TILES, ROOM_MIN_TILES } from "@regulus/protocol";
import {
  COMPASS_DIRECTIONS,
  DECOR_STYLE_SPECS,
  generateRoom,
  maxDeskCount,
  type RoomLayout,
} from "@regulus/room-layout";
import {
  COMMON_MODEL_IDS,
  floorPieceFor,
  ROOM_MATERIAL_PIECES,
  resolveModelId,
  STYLE_MODELS,
  wallPieceFor,
} from "./generatorModels.ts";
import { isPieceId } from "./kit.ts";
import { lairSitSpec } from "./models.ts";
import { lairRoomScene } from "./roomScene.ts";

/** Every style and size, each door side in turn, with one desk and with the most desks. */
function* allRooms(): Generator<RoomLayout> {
  let k = 0;
  for (const decorStyle of DECOR_STYLES) {
    for (let width = ROOM_MIN_TILES; width <= ROOM_MAX_TILES; width++) {
      for (let depth = ROOM_MIN_TILES; depth <= ROOM_MAX_TILES; depth++) {
        const doorSide = COMPASS_DIRECTIONS[k++ % COMPASS_DIRECTIONS.length] ?? "south";
        const max = maxDeskCount(width, depth);
        for (const deskCount of new Set([1, max])) {
          yield generateRoom({ width, depth, doorSide, deskCount, decorStyle });
        }
      }
    }
  }
}

const rooms = [...allRooms()];

describe("generator model ids (#182) → lair art", () => {
  test("every model id the generator emits, in every style and size, resolves", () => {
    const unknown = new Set<string>();
    const seen = new Set<string>();
    for (const room of rooms) {
      for (const id of Object.values(room.room.models)) {
        seen.add(id);
        if (!resolveModelId(id)) unknown.add(id);
      }
    }
    expect([...unknown]).toEqual([]);
    // Sanity: the sweep saw every style's own pieces.
    for (const style of DECOR_STYLES)
      expect([...seen].some((id) => id.startsWith(`lair/${style}/`))).toBe(true);
  });

  test("every style's declared model and every common fallback resolves to a known piece", () => {
    const declared = Object.values(DECOR_STYLE_SPECS).flatMap((s) => Object.values(s.models));
    for (const id of [...declared, ...COMMON_MODEL_IDS, ...Object.keys(STYLE_MODELS)]) {
      const b = resolveModelId(id);
      expect(b, id).toBeDefined();
      if (b && "model" in b) expect(isPieceId(b.model.piece), id).toBe(true);
    }
    expect(resolveModelId("lair/common/no_such_thing")).toBeUndefined();
    expect(resolveModelId("lair/ops_room/no-such-thing")).toBeUndefined();
  });

  test("boards, the queue clipboard and the gong keep their swappable Looks", () => {
    expect(resolveModelId("lair/common/issue_board")).toEqual({ look: "board" });
    expect(resolveModelId("lair/common/pr_board")).toEqual({ look: "board" });
    expect(resolveModelId("lair/common/queue_clipboard")).toEqual({ look: "clipboard" });
    expect(resolveModelId("lair/common/gong")).toEqual({ look: "gong" });
  });

  test("every chair a style seats people on has sit points (data-driven seated fit)", () => {
    const chairIds = Object.values(DECOR_STYLE_SPECS).map(
      (s) => s.models.chair ?? "lair/common/chair",
    );
    for (const id of chairIds) {
      const b = resolveModelId(id);
      if (!b || !("model" in b)) throw new Error(`${id} has no model`);
      const spec = lairSitSpec(b.model);
      expect(spec, id).toBeDefined();
      // Cushions within 3 cm of 0.33 m, so the seated henchman fits every style's chair.
      expect(Math.abs((spec?.seatTop ?? 0) * (spec?.size.h ?? 0) - 0.33), id).toBeLessThan(0.03);
      expect((spec?.backTop ?? 0) * (spec?.size.h ?? 0), id).toBeLessThanOrEqual(0.83);
    }
  });

  test("every style's floor and wall material has a piece", () => {
    for (const spec of Object.values(DECOR_STYLE_SPECS)) {
      expect(
        Object.hasOwn(ROOM_MATERIAL_PIECES.floor, spec.floorMaterial),
        spec.floorMaterial,
      ).toBe(true);
      expect(Object.hasOwn(ROOM_MATERIAL_PIECES.wall, spec.wallMaterial), spec.wallMaterial).toBe(
        true,
      );
      expect(isPieceId(floorPieceFor(spec.floorMaterial))).toBe(true);
      expect(isPieceId(wallPieceFor(spec.wallMaterial))).toBe(true);
    }
  });
});

describe("lairRoomScene draws a generated room", () => {
  test("no generated room has a piece without art", () => {
    for (const room of rooms) expect(lairRoomScene(room).missing).toEqual([]);
  });

  test("a full room: shell, a chair per desk seat, clutter on desks, Looks and lights", () => {
    const layout = generateRoom({
      width: 10,
      depth: 8,
      doorSide: "south",
      deskCount: 4,
      decorStyle: "ops_room",
    });
    const scene = lairRoomScene(layout);
    const count = (piece: string) => scene.pieces.filter((p) => p.piece === piece).length;
    const deskSeats = layout.seats.filter((s) => s.kind === "desk").length;
    expect(count("swivel_chair")).toBe(deskSeats);
    expect(count("floor_concrete") + count("floor_concrete_worn")).toBe(80);
    // The two-tile doorway is one wide blast door with a beacon over each face.
    expect(scene.doors).toHaveLength(1);
    expect(scene.doors[0]?.span).toBe(2);
    expect(scene.beacons).toHaveLength(2);
    expect(scene.looks.map((l) => l.look).sort()).toContain("board");
    expect(scene.lights.length).toBeGreaterThan(0);
    expect(count("ceiling_light")).toBe(
      layout.room.lighting.lights.filter((l) => l.kind === "pendant").length,
    );
    // Clutter stands on the desks' tops.
    const clutter = scene.pieces.filter((p) =>
      ["desk_plant", "desk_mugs", "fruit_bowl", "desk_books"].includes(p.piece),
    );
    expect(clutter.length).toBeGreaterThan(0);
    for (const c of clutter) expect(c.position[1]).toBeGreaterThan(0.3);
  });

  test("each style dresses the same layout differently", () => {
    const pieceSets = DECOR_STYLES.map((decorStyle) => {
      const layout = generateRoom({
        width: 8,
        depth: 8,
        doorSide: "east",
        deskCount: 2,
        decorStyle,
      });
      return new Set(lairRoomScene(layout).pieces.map((p) => p.piece));
    });
    for (let i = 1; i < pieceSets.length; i++) {
      const a = pieceSets[0] ?? new Set();
      const b = pieceSets[i] ?? new Set();
      expect([...b].some((p) => !a.has(p))).toBe(true);
    }
  });
});
