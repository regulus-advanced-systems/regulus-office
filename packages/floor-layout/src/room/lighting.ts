/**
 * Room lighting (#182, SPEC §12): a hemisphere light from the decor style,
 * a warm pendant pool over every desk, a pool at every floor lamp and one
 * accent light washing the boards. Data only; the scene pools the lights.
 */
import { wallPoint } from "../query.ts";
import type { Obstacle, Wall, WallAnchor } from "../types.ts";
import type { Furnishing } from "./pods.ts";
import type { DecorStyleSpec } from "./styles.ts";
import type { RoomLight, RoomLighting } from "./types.ts";

export function roomLighting(
  style: DecorStyleSpec,
  f: Furnishing,
  anchors: readonly WallAnchor[],
  walls: readonly Wall[],
  lampIds: readonly string[],
  obstacles: readonly Obstacle[],
): RoomLighting {
  const l = style.lighting;
  const lights: RoomLight[] = [];
  for (const desk of f.desks) {
    const table = obstacles.find((o) => o.id === desk.tableId);
    if (!table) continue;
    lights.push({
      id: `${desk.id}-light`,
      kind: "pendant",
      x: table.rect.x + table.rect.w / 2,
      y: 2.6,
      z: table.rect.z + table.rect.d / 2,
      color: l.pendant,
      intensity: l.pendantIntensity,
      range: 5,
    });
  }
  for (const id of lampIds) {
    const lamp = obstacles.find((o) => o.id === id);
    if (!lamp) continue;
    lights.push({
      id: `${id}-light`,
      kind: "lamp",
      x: lamp.rect.x + lamp.rect.w / 2,
      y: 1.5,
      z: lamp.rect.z + lamp.rect.d / 2,
      color: l.lamp,
      intensity: 0.9,
      range: 4,
    });
  }
  const board = anchors.find((a) => a.kind === "issue_board");
  const wall = board && walls.find((w) => w.id === board.wallId);
  if (board && wall) {
    const p = wallPoint(wall, board.t);
    const inward = wall.facing === "south" ? { x: 0, z: 1 } : { x: 1, z: 0 };
    lights.push({
      id: "board-accent",
      kind: "accent",
      x: p.x + inward.x * 1.2,
      y: 2.4,
      z: p.z + inward.z * 1.2,
      color: l.accent,
      intensity: 0.6,
      range: 6,
    });
  }
  return { sky: l.sky, ground: l.ground, ambient: l.ambient, lights };
}
