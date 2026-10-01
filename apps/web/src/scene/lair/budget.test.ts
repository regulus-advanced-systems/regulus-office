import { describe, expect, test } from "bun:test";
import { HEADING } from "@regulus/room-layout";
import { corridorCell, roomShell } from "./assembly.ts";
import {
  kitDrawCalls,
  LAIR_DRAW_CALL_BUDGET,
  ROOM_DRAW_CALL_BUDGET,
  ROOM_TRIANGLE_BUDGET,
  sceneCost,
} from "./budget.ts";
import { lairModelScene } from "./components/LairModels.tsx";
import { corridorOrigin, mainRoom } from "./debug/sampleRooms.ts";
import { sampleCorridors } from "./debug/sampleScene.ts";
import { CORRIDOR_WIDTH, WALL_THICKNESS } from "./dimensions.ts";
import { LAIR_MODEL_IDS } from "./models.ts";
import {
  instanceTints,
  type PiecePlacement,
  placementMatrix,
  transformPlacements,
} from "./placements.ts";

describe("draw-call budget (budget.ts)", () => {
  test("every piece type on screen at once stays inside the kit budget", () => {
    expect(kitDrawCalls()).toBeLessThanOrEqual(LAIR_DRAW_CALL_BUDGET);
  });

  test("the generated sample room with its corridor junction stays inside the room budget", () => {
    const room = mainRoom("ops_room");
    const corridors = sampleCorridors(corridorOrigin(room, CORRIDOR_WIDTH, WALL_THICKNESS));
    // + lamps, beacon domes, door leaves (body and glow) and the shadow layer.
    expect(sceneCost([...room.pieces, ...corridors.pieces]).drawCalls + 5).toBeLessThanOrEqual(
      ROOM_DRAW_CALL_BUDGET,
    );
  });

  test("instancing: two hundred corridor cells cost the same draws as one", () => {
    const one = corridorCell("straight").pieces;
    const many: PiecePlacement[] = [];
    for (let i = 0; i < 200; i++) many.push(...corridorCell("straight", 0, [0, 0, i * 4]).pieces);
    expect(sceneCost(many).drawCalls).toBe(sceneCost(one).drawCalls);
    expect(sceneCost(many).instances).toBe(200 * one.length);
  });

  test("the largest room (12 x 12 tiles) fully furnished stays inside the triangle budget", () => {
    const shell = roomShell({
      w: 12,
      d: 12,
      door: { side: "south", tile: 5 },
      services: ["north", "west", "east"],
      beams: [6, 12, 18],
    });
    // One of every model id, plus 8 pod desks with 32 chairs and laptops.
    const items = LAIR_MODEL_IDS.map((id, i) => ({
      id,
      rect: { x: 1 + (i % 6) * 3.5, z: 1 + Math.floor(i / 6) * 3.5, w: 1.6, d: 1.2 },
      heading: HEADING.south,
    }));
    for (let k = 0; k < 8; k++)
      items.push({
        id: "desk",
        rect: { x: 2 + k * 2.5, z: 18, w: 1.6, d: 1.2 },
        heading: HEADING.south,
      });
    const chairs = Array.from({ length: 32 }, () => ({
      piece: "swivel_chair" as const,
      position: [0, 0, 0] as const,
    }));
    const laptops = Array.from({ length: 32 }, () => ({
      piece: "laptop" as const,
      position: [0, 0.76, 0] as const,
    }));
    const cost = sceneCost([
      ...shell.pieces,
      ...lairModelScene(items).pieces,
      ...chairs,
      ...laptops,
    ]);
    expect(cost.triangles).toBeLessThanOrEqual(ROOM_TRIANGLE_BUDGET);
  });
});

describe("placements", () => {
  test("transformPlacements rotates positions and yaws together", () => {
    const [p] = transformPlacements(
      [{ piece: "crate", position: [1, 0, 0], rotationY: 0 }],
      [10, 0, 0],
      Math.PI / 2,
    );
    expect(p?.position[0]).toBeCloseTo(10);
    expect(p?.position[2]).toBeCloseTo(-1);
    expect(p?.rotationY).toBeCloseTo(Math.PI / 2);
  });

  test("the pivot is applied before scale and rotation", () => {
    const m = placementMatrix({
      piece: "crate",
      position: [5, 0, 0],
      rotationY: Math.PI,
      scale: [2, 1, 1],
      pivot: [1, 0, 0],
    });
    const e = m.elements;
    // Local (0,0,0) -> pivot (1,0,0) -> scaled (2,0,0) -> turned (-2,0,0) -> moved (3,0,0).
    expect(e[12]).toBeCloseTo(3);
  });

  test("tints only allocate when used", () => {
    expect(instanceTints([{ piece: "barrel", position: [0, 0, 0] }])).toBeNull();
    const t = instanceTints([
      { piece: "barrel", position: [0, 0, 0] },
      { piece: "barrel", position: [0, 0, 0], tint: "#000000" },
    ]);
    expect(t ? [...t] : []).toEqual([1, 1, 1, 0, 0, 0]);
  });
});
