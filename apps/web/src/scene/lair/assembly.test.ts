import { describe, expect, test } from "bun:test";
import {
  CORRIDOR_KINDS,
  CORRIDOR_OPEN,
  corridorCell,
  corridorOpenSides,
  floorPiece,
  roomShell,
  rotateSide,
  WALL_YAW,
  wallSegment,
} from "./assembly.ts";
import { TILE, WALL_THICKNESS } from "./dimensions.ts";
import { isPieceId } from "./kit.ts";
import type { PiecePlacement } from "./placements.ts";

const count = (items: readonly PiecePlacement[], pred: (p: PiecePlacement) => boolean) =>
  items.filter(pred).length;
const isWall = (p: PiecePlacement) =>
  p.piece.startsWith("wall_rock") || p.piece === "wall_concrete" || p.piece === "wall_steel";

describe("roomShell", () => {
  const shell = roomShell({
    w: 6,
    d: 4,
    door: { side: "south", tile: 2 },
    services: ["north"],
    beams: [6],
  });

  test("one floor tile per grid tile, every piece id known", () => {
    expect(count(shell.pieces, (p) => p.piece.startsWith("floor_"))).toBe(24);
    for (const p of shell.pieces) expect(isPieceId(p.piece)).toBe(true);
  });

  test("a wall segment and a ceiling-edge trim per tile of perimeter, less the door", () => {
    const perimeter = 2 * (6 + 4);
    expect(count(shell.pieces, isWall)).toBe(perimeter - 1);
    expect(count(shell.pieces, (p) => p.piece === "wall_trim")).toBe(perimeter - 1);
    expect(shell.doors).toHaveLength(1);
    // One beacon over each face of the door.
    expect(shell.beacons).toHaveLength(2);
    expect(count(shell.pieces, (p) => p.piece === "wall_pillar")).toBe(4);
  });

  test("the door replaces the right segment and faces into the room", () => {
    expect(shell.doors[0]?.position).toEqual(wallSegment("south", 2, 6, 4));
    expect(shell.doors[0]?.rotationY).toBe(WALL_YAW.south);
    // Beacons sit over the door, one on the room side and one on the corridor side.
    const [inside, outside] = shell.beacons.map((b) => b.position);
    const wallZ = 4 * TILE + WALL_THICKNESS / 2;
    expect(inside?.[0]).toBeCloseTo(5, 5);
    expect(inside?.[1] ?? 0).toBeGreaterThan(2.3);
    expect(inside?.[2] ?? 0).toBeLessThan(wallZ);
    expect(outside?.[2] ?? 0).toBeGreaterThan(wallZ);
  });

  test("walls sit outside the room edge with their room side on it", () => {
    expect(wallSegment("north", 0, 6, 4)).toEqual([1, 0, -WALL_THICKNESS / 2]);
    expect(wallSegment("east", 1, 6, 4)).toEqual([12 + WALL_THICKNESS / 2, 0, 3]);
    // A piece's +z front turned by WALL_YAW points into the room.
    const into = (yaw: number) => [Math.sin(yaw), Math.cos(yaw)];
    expect(into(WALL_YAW.north)[1]).toBeCloseTo(1);
    expect(into(WALL_YAW.west)[0]).toBeCloseTo(1);
    expect(into(WALL_YAW.east)[0]).toBeCloseTo(-1);
    expect(into(WALL_YAW.south)[1]).toBeCloseTo(-1);
  });

  test("services, lamps and beams with their pendants", () => {
    expect(count(shell.pieces, (p) => p.piece === "pipe_run")).toBe(6);
    expect(shell.lamps.length).toBe(
      count(shell.pieces, (p) => p.piece === "wall_lamp" || p.piece === "ceiling_light"),
    );
    expect(count(shell.pieces, (p) => p.piece === "ceiling_beam")).toBe(1);
    expect(count(shell.pieces, (p) => p.piece === "ceiling_light")).toBeGreaterThan(0);
  });

  test("concrete floors are worn on some tiles but not all", () => {
    const kinds = new Set<string>();
    for (let i = 0; i < 12; i++)
      for (let j = 0; j < 12; j++) kinds.add(floorPiece("floor_concrete", i, j));
    expect(kinds).toEqual(new Set(["floor_concrete", "floor_concrete_worn"]));
    expect(floorPiece("floor_steel", 1, 1)).toBe("floor_steel");
  });
});

describe("corridor cells", () => {
  test("rotateSide turns clockwise seen from above", () => {
    expect(rotateSide("north", 1)).toBe("east");
    expect(rotateSide("west", 1)).toBe("north");
    expect(rotateSide("north", -1)).toBe("west");
  });

  test.each([...CORRIDOR_KINDS])(
    "%s: two wall segments per closed side, none on open sides",
    (kind) => {
      for (let q = 0; q < 4; q++) {
        const cell = corridorCell(kind, q);
        const closed = 4 - CORRIDOR_OPEN[kind].length;
        expect(count(cell.pieces, isWall)).toBe(closed * 2);
        expect(count(cell.pieces, (p) => p.piece.startsWith("floor_"))).toBe(4);
        expect(count(cell.pieces, (p) => p.piece === "ceiling_light")).toBe(1);
        expect(count(cell.pieces, (p) => p.piece === "ceiling_beam")).toBe(1);
        for (const p of cell.pieces) expect(isPieceId(p.piece)).toBe(true);
      }
    },
  );

  test("open sides follow the rotation", () => {
    expect(corridorOpenSides("straight", 1).sort()).toEqual(["east", "west"]);
    expect(corridorOpenSides("corner", 2).sort()).toEqual(["south", "west"]);
    expect(corridorOpenSides("tee", 0).sort()).toEqual(["east", "south", "west"]);
  });

  test("a straight run's beam spans wall to wall; a junction's runs pillar to pillar", () => {
    const straight = corridorCell("straight").pieces.find((p) => p.piece === "ceiling_beam");
    const cross = corridorCell("cross").pieces.find((p) => p.piece === "ceiling_beam");
    expect(straight?.rotationY).toBe(0);
    expect(cross?.rotationY).toBeCloseTo(-Math.PI / 4);
    expect(cross?.scale?.[0] ?? 0).toBeGreaterThan(straight?.scale?.[0] ?? 0);
  });

  test("pillars only stand where a wall ends", () => {
    expect(count(corridorCell("cross").pieces, (p) => p.piece === "wall_pillar")).toBe(0);
    expect(count(corridorCell("straight").pieces, (p) => p.piece === "wall_pillar")).toBe(4);
    expect(count(corridorCell("tee").pieces, (p) => p.piece === "wall_pillar")).toBe(2);
  });

  test("the origin offsets every piece", () => {
    const a = corridorCell("corner", 1);
    const b = corridorCell("corner", 1, [10, 0, -4]);
    a.pieces.forEach((p, i) => {
      expect(b.pieces[i]?.position[0]).toBeCloseTo(p.position[0] + 10);
      expect(b.pieces[i]?.position[2]).toBeCloseTo(p.position[2] - 4);
    });
  });
});
