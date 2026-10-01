/**
 * The debug scene's set pieces (#183) besides the generated rooms
 * (sampleRooms.ts): the corridor junction outside the main room's door
 * (straight, cross, tee and corner cells), a room under construction, and a
 * catalogue apron with one of every piece. Pure data, so the budget tests
 * can cost it.
 */
import { corridorCell, type RoomShell, roomShell } from "../assembly.ts";
import { CORRIDOR_WIDTH } from "../dimensions.ts";
import type { Vec3 } from "../geometry/builder.ts";
import { PIECE_IDS, type PieceId } from "../kit.ts";
import type { PiecePlacement } from "../placements.ts";

/** The corridor junction outside the main room's door: straight, cross, then a corner, a tee and a dead straight. */
export function sampleCorridors(origin: Vec3): RoomShell {
  const [x0, , z0] = origin;
  const W = CORRIDOR_WIDTH;
  const cells = [
    corridorCell("straight", 0, [x0, 0, z0]),
    corridorCell("cross", 0, [x0, 0, z0 + W]),
    corridorCell("corner", 2, [x0 + W, 0, z0 + W]),
    corridorCell("tee", 0, [x0 - W, 0, z0 + W]),
    corridorCell("straight", 0, [x0, 0, z0 + 2 * W]),
  ];
  return {
    pieces: cells.flatMap((c) => c.pieces),
    doors: [],
    beacons: [],
    lamps: cells.flatMap((c) => c.lamps),
  };
}

/** A 4 x 4 tile room being built west of the ops room. */
export const BUILD_SITE = { x: -12, z: 2 } as const;

export function sampleBuildSite(): RoomShell {
  const shell = roomShell({
    w: 4,
    d: 4,
    door: { side: "east", tile: 1 },
    lampEvery: 0,
    floor: "floor_steel",
  });
  const { x, z } = BUILD_SITE;
  const move = (p: PiecePlacement): PiecePlacement => ({
    ...p,
    position: [p.position[0] + x, p.position[1], p.position[2] + z],
  });
  // Only the north and west walls are up yet; the rest is scaffolding.
  const pieces = shell.pieces
    .filter(
      (p) =>
        !(
          (p.piece.startsWith("wall_rock") || p.piece === "wall_trim") &&
          (p.position[0] > 7 || p.position[2] > 7)
        ),
    )
    .map(move);
  const site: PiecePlacement[] = [
    { piece: "scaffold", position: [x + 7, 0, z + 1] },
    { piece: "scaffold", position: [x + 7, 0, z + 5] },
    { piece: "scaffold", position: [x + 3, 0, z + 7], rotationY: Math.PI / 2 },
    { piece: "crate_stack", position: [x + 2, 0, z + 2.2], rotationY: 0.3 },
    { piece: "crate", position: [x + 4.2, 0, z + 1.4], rotationY: -0.4 },
    { piece: "cable_drum", position: [x + 4.5, 0, z + 4.6], rotationY: 0.8 },
    { piece: "barrier", position: [x + 9.2, 0, z + 5.6], rotationY: Math.PI / 2 },
    { piece: "barrier", position: [x + 9.2, 0, z + 1.4], rotationY: Math.PI / 2 },
    { piece: "work_light", position: [x + 1.2, 0, z + 6.6], rotationY: Math.PI * 0.8 },
    { piece: "barrel", position: [x + 5.6, 0, z + 6.6] },
    { piece: "rock_pile", position: [x + 1.3, 0, z + 4.4], rotationY: 1.1 },
    { piece: "rock_pile", position: [x + 5.8, 0, z + 2.7], rotationY: 2.4 },
  ];
  return {
    pieces: [...pieces, ...site],
    doors: shell.doors.map((d) => ({
      ...d,
      position: [d.position[0] + x, d.position[1], d.position[2] + z] as const,
    })),
    beacons: shell.beacons.map((b) => ({
      ...b,
      position: [b.position[0] + x, b.position[1], b.position[2] + z] as const,
    })),
    lamps: [{ piece: "work_light", position: [x + 1.2, 0, z + 6.6], rotationY: Math.PI * 0.8 }],
  };
}

/** The catalogue apron: one of every piece in rows by category, east of the room. */
export const CATALOGUE_ORIGIN = { x: 27, z: 0 } as const;

export function catalogue(): {
  placements: PiecePlacement[];
  labels: { id: PieceId; position: readonly [number, number, number] }[];
} {
  const placements: PiecePlacement[] = [];
  const labels: { id: PieceId; position: readonly [number, number, number] }[] = [];
  const perRow = 12;
  const pitch = 3.4;
  PIECE_IDS.forEach((id, i) => {
    const col = i % perRow;
    const row = Math.floor(i / perRow);
    const x = CATALOGUE_ORIGIN.x + col * pitch;
    const z = CATALOGUE_ORIGIN.z + row * pitch;
    placements.push({ piece: id, position: [x, 0, z] });
    // Labels float just above each piece, staggered so neighbours do not collide.
    // Labels lie on the floor in front of each piece, so they never collide.
    labels.push({ id, position: [x, 0.05, z + 1.45] });
  });
  return { placements, labels };
}
