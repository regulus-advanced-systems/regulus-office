/**
 * A generated room (#182 `generateRoom`) as lair art (#183): the shell from
 * its size, door and materials, every obstacle, chair, desk prop and wall
 * item from its model ids (generatorModels.ts), the console lamps, the Look
 * anchors (boards, queue clipboard, gong) for their own components, and the
 * room's pooled lights with pendants on exposed beams. Pure data; the debug
 * route draws it, and #186 can draw rooms the same way.
 */
import {
  type CompassDirection,
  DIRECTION,
  type RoomLayout,
  type RoomLight,
  type Wall,
  wallPoint,
} from "@regulus/room-layout";
import { furnitureHeading } from "../furniture/placement.ts";
import { type RoomShell, roomShell } from "./assembly.ts";
import { type WorldLamp, worldLamps } from "./components/BlinkingLamps.tsx";
import { TILE } from "./dimensions.ts";
import { floorPieceFor, type LookId, resolveModelId, wallPieceFor } from "./generatorModels.ts";
import type { Vec3 } from "./geometry/builder.ts";
import { WALL_RELIEF } from "./geometry/walls.ts";
import { pieceSize } from "./kit.ts";
import { fitModel, type LairModel, surfaceHeight } from "./models.ts";
import type { PiecePlacement } from "./placements.ts";

export interface LookItem {
  id: string;
  look: LookId;
  position: Vec3;
  rotationY: number;
  w: number;
  h: number;
  /** Anchor centre height (the gong's distance to the floor). */
  floor: number;
}

export interface LairRoomScene extends RoomShell {
  /** Blinking console lamps, world space. */
  consoleLamps: WorldLamp[];
  looks: LookItem[];
  /** The room's pooled lights (generator data). */
  lights: readonly RoomLight[];
  /** Model ids with no lair art (should stay empty; generatorModels.test.ts). */
  missing: string[];
}

const OPPOSITE: Readonly<Record<CompassDirection, CompassDirection>> = {
  north: "south",
  south: "north",
  east: "west",
  west: "east",
};

/** Placement of a wall item: centred on its anchor, standing `off` metres proud of the wall line. */
function onWall(
  wall: Wall,
  t: number,
  y: number,
  off: number,
): { position: Vec3; rotationY: number } {
  const p = wallPoint(wall, t);
  const f = DIRECTION[wall.facing];
  return { position: [p.x + f.x * off, y, p.z + f.z * off], rotationY: Math.atan2(f.x, f.z) };
}

export function lairRoomScene(layout: RoomLayout): LairRoomScene {
  const { room } = layout;
  const missing: string[] = [];
  const resolve = (id: string) => {
    const modelId = room.models[id];
    const b = modelId ? resolveModelId(modelId) : undefined;
    if (!b) missing.push(modelId ?? `(no model for ${id})`);
    return b;
  };

  // Shell: the door spans whole tiles along its side; full-height walls carry the services.
  const along = room.door.start / TILE;
  const span = Math.max(1, Math.round((room.door.end - room.door.start) / TILE));
  const wall = wallPieceFor(room.materials.wall);
  const full = layout.walls.filter((w) => w.height === "full").map((w) => OPPOSITE[w.facing]);
  const shell = roomShell({
    w: room.width,
    d: room.depth,
    door: { side: room.doorSide, tile: along, span },
    floor: floorPieceFor(room.materials.floor),
    finish: { north: wall, east: wall, south: wall, west: wall },
    services: [...new Set(full)],
    lampEvery: 3,
  });
  const pieces = [...shell.pieces];
  const consoleLamps: WorldLamp[] = [];
  const looks: LookItem[] = [];

  const placed = new Map<string, { model: LairModel; placement: PiecePlacement }>();
  for (const o of layout.obstacles) {
    const b = resolve(o.id);
    if (!b || !("model" in b)) continue;
    const placement = fitModel(b.model, o.rect, furnitureHeading(o, layout.seats, layout.size));
    placed.set(o.id, { model: b.model, placement });
    pieces.push(placement);
    if (b.model.lamps) consoleLamps.push(...worldLamps([placement], b.model.lamps));
  }

  for (const seat of layout.seats) {
    const b = resolve(seat.id);
    // A couch or armchair seat is its furniture; only chairs are drawn per seat.
    if (seat.kind === "couch" || !b || !("model" in b)) continue;
    pieces.push({
      piece: b.model.piece,
      position: [seat.pose.x, 0, seat.pose.z],
      rotationY: seat.pose.heading + Math.PI,
      tint: b.model.tint,
    });
  }

  for (const item of layout.decor ?? []) {
    const b = resolve(item.id);
    const base = placed.get(item.on);
    if (!b || !("model" in b)) continue;
    const y = base ? surfaceHeight(base.model, base.placement) : 0.76;
    pieces.push({
      piece: b.model.piece,
      position: [item.x, y, item.z],
      rotationY: item.heading,
      tint: b.model.tint,
    });
  }

  // Wall items stand clear of the finish's relief (rock bulges out).
  const relief =
    WALL_RELIEF[wall === "wall_rock" ? "rock" : wall === "wall_steel" ? "steel" : "concrete"];
  const wallItems = [...(layout.wallDecor ?? []), ...layout.wallAnchors];
  for (const item of wallItems) {
    const b = resolve(item.id);
    const w = layout.walls.find((x) => x.id === item.wallId);
    if (!b || !w) continue;
    const at = onWall(w, item.t, item.y, relief + 0.01);
    if ("look" in b) {
      looks.push({ id: item.id, look: b.look, ...at, w: item.w, h: item.h, floor: item.y });
      continue;
    }
    const size = pieceSize(b.model.piece);
    const sx = item.w / Math.max(size.w, 1e-6);
    const sy = item.h / Math.max(size.h, 1e-6);
    pieces.push({
      piece: b.model.piece,
      ...at,
      scale: [sx, sy, Math.min(sx, sy)],
      tint: b.model.tint,
    });
  }

  // Pendants over the desks hang from exposed beams spanning the room.
  const lamps = [...shell.lamps];
  const beams = new Set<number>();
  for (const light of room.lighting.lights) {
    if (light.kind !== "pendant") continue;
    const lamp: PiecePlacement = { piece: "ceiling_light", position: [light.x, 0, light.z] };
    pieces.push(lamp);
    lamps.push(lamp);
    beams.add(Math.round(light.z * 100) / 100);
  }
  const width = room.width * TILE;
  for (const z of beams) {
    pieces.push({ piece: "ceiling_beam", position: [width / 2, 0, z], scale: [width + 0.4, 1, 1] });
  }

  return {
    ...shell,
    pieces,
    lamps,
    consoleLamps,
    looks,
    lights: room.lighting.lights,
    missing,
  };
}
