import { describe, expect, test } from "bun:test";
import { lobbyTemplate, PALETTES, WALL_THICKNESS } from "@regulus/floor-layout";
import {
  boxFaceIndex,
  CAP_HEIGHT,
  planeYawFacing,
  roomColors,
  roomPieces,
  WALL_SURFACE_GAP,
  WINDOW_HEIGHT,
  WINDOW_SILL,
  wallFaces,
} from "./roomPieces.ts";

const pieces = roomPieces(lobbyTemplate);
/** Lobby footprint; the tests follow the template rather than fixed numbers. */
const W = lobbyTemplate.size.width;
const D = lobbyTemplate.size.depth;

describe("roomPieces(lobby, { frontWalls: 'full' })", () => {
  const fpv = roomPieces(lobbyTemplate, { frontWalls: "full" });

  test("every wall is full height and no caps are drawn", () => {
    expect(fpv.walls.every((w) => w.height === "full")).toBe(true);
    expect(fpv.caps).toEqual([]);
    const south = fpv.walls.find((w) => w.id === "south");
    expect(south?.center).toEqual([W / 2, 1.5, D]);
    expect(south?.size).toEqual([W + WALL_THICKNESS, 3, WALL_THICKNESS]);
    const east = fpv.walls.find((w) => w.id === "east");
    expect(east?.size).toEqual([WALL_THICKNESS, 3, D + WALL_THICKNESS]);
  });

  test("the back walls, windows and floor are unchanged", () => {
    expect(fpv.floor).toEqual(pieces.floor);
    expect(fpv.windows).toEqual(pieces.windows);
    expect(fpv.walls.find((w) => w.id === "north")).toEqual(
      pieces.walls.find((w) => w.id === "north") as never,
    );
  });

  test("the name plate grows with the promoted wall", () => {
    expect(fpv.name?.height).toBe(3);
    expect(fpv.name?.center[1]).toBe(1.5);
    expect(pieces.name?.height).toBe(0.4);
  });

  test("the default is the dollhouse stub mode", () => {
    expect(roomPieces(lobbyTemplate, { frontWalls: "stub" })).toEqual(pieces);
  });
});

describe("roomPieces(lobby)", () => {
  test("floor covers the template footprint, centred", () => {
    expect(pieces.floor).toEqual({ center: [W / 2, 0, D / 2], width: W, depth: D });
  });

  test("north and west are full back walls, south and east are stubs with caps", () => {
    const byId = new Map(pieces.walls.map((w) => [w.id, w]));
    expect(byId.get("north")?.height).toBe("full");
    expect(byId.get("west")?.height).toBe("full");
    expect(byId.get("south")?.height).toBe("stub");
    expect(byId.get("east")?.height).toBe("stub");
    expect(pieces.caps.map((c) => c.id).sort()).toEqual(["east-cap", "south-cap"]);
  });

  test("wall boxes sit on the segment with the nav thickness and the right height", () => {
    const north = pieces.walls.find((w) => w.id === "north");
    expect(north?.center).toEqual([W / 2, 1.5, 0]);
    expect(north?.size).toEqual([W + WALL_THICKNESS, 3, WALL_THICKNESS]);
    expect(north?.facing).toBe("south");
    expect(north?.exterior).toBe("north");
    const east = pieces.walls.find((w) => w.id === "east");
    expect(east?.center).toEqual([W, 0.2, D / 2]);
    expect(east?.size).toEqual([WALL_THICKNESS, 0.4, D + WALL_THICKNESS]);
  });

  test("caps sit on top of the stubs and overhang them", () => {
    const cap = pieces.caps.find((c) => c.id === "south-cap");
    const stub = pieces.walls.find((w) => w.id === "south");
    if (!cap || !stub) throw new Error("missing south");
    expect(cap.center[1]).toBeCloseTo(0.4 + CAP_HEIGHT / 2, 9);
    expect(cap.size[0]).toBeGreaterThan(stub.size[0]);
    expect(cap.size[2]).toBeGreaterThan(stub.size[2]);
  });

  test("windows come from full-wall openings, on the interior face", () => {
    expect(pieces.windows).toHaveLength(3);
    const first = pieces.windows.find((w) => w.id === "north-window-0");
    if (!first) throw new Error("no north window");
    const opening = lobbyTemplate.walls.find((w) => w.id === "north")?.openings[0];
    if (!opening) throw new Error("no north opening");
    expect(first.center[0]).toBeCloseTo(opening.t + opening.w / 2, 9);
    expect(first.center[1]).toBeCloseTo(WINDOW_SILL + WINDOW_HEIGHT / 2, 9);
    expect(first.center[2]).toBeCloseTo(WALL_THICKNESS / 2 + WALL_SURFACE_GAP, 9);
    expect(first.yaw).toBeCloseTo(0, 9);
    const west = pieces.windows.find((w) => w.id === "west-window-0");
    expect(west?.center[0]).toBeCloseTo(WALL_THICKNESS / 2 + WALL_SURFACE_GAP, 9);
    expect(west?.yaw).toBeCloseTo(Math.PI / 2, 9);
  });

  test("floor name goes on the exterior of the south stub, facing south", () => {
    const name = pieces.name;
    if (!name) throw new Error("no name plate");
    expect(name.wallId).toBe("south");
    expect(name.center[2]).toBeCloseTo(D + WALL_THICKNESS / 2 + WALL_SURFACE_GAP, 9);
    expect(name.center[1]).toBeCloseTo(0.2, 9);
    expect(name.width).toBe(W);
    expect(name.height).toBe(0.4);
    expect(name.yaw).toBeCloseTo(0, 9);
  });
});

describe("box faces", () => {
  test("planeYawFacing matches three.js rotation.y for a +z-fronted plane", () => {
    expect(planeYawFacing({ x: 0, z: 1 })).toBeCloseTo(0, 9);
    expect(planeYawFacing({ x: 1, z: 0 })).toBeCloseTo(Math.PI / 2, 9);
    expect(planeYawFacing({ x: -1, z: 0 })).toBeCloseTo(-Math.PI / 2, 9);
    expect(Math.abs(planeYawFacing({ x: 0, z: -1 }))).toBeCloseTo(Math.PI, 9);
  });

  test("boxFaceIndex follows BoxGeometry group order", () => {
    expect([boxFaceIndex("east"), boxFaceIndex("west"), boxFaceIndex("up")]).toEqual([0, 1, 2]);
    expect([boxFaceIndex("down"), boxFaceIndex("south"), boxFaceIndex("north")]).toEqual([3, 4, 5]);
  });

  test("wallFaces puts the exterior on the outside and interior toward the room", () => {
    const south = wallFaces({ facing: "north", exterior: "south" });
    expect(south[4]).toBe("exterior");
    expect(south[5]).toBe("interior");
    expect(south[2]).toBe("top");
    const west = wallFaces({ facing: "east", exterior: "west" });
    expect(west[1]).toBe("exterior");
    expect(west[0]).toBe("interior");
  });
});

describe("roomColors", () => {
  test("teal/cream palette maps to floor, walls, exterior and cap", () => {
    const p = PALETTES[0];
    if (!p) throw new Error("no palette");
    const c = roomColors(p);
    expect(c.floor).toBe("#30B090");
    expect(c.interior("north")).toBe(p.wall);
    expect(c.interior("west")).toBe(p.wallAlt as string);
    expect(c.interior("south")).toBe(p.wall);
    expect(c.exterior).toBe(p.exterior);
    expect(c.cap).toBe(p.cap);
  });

  test("falls back to `wall` when the palette has no wallAlt", () => {
    const p = PALETTES.find((x) => !x.wallAlt);
    if (!p) throw new Error("expected a palette without wallAlt");
    expect(roomColors(p).interior("west")).toBe(p.wall);
  });
});
