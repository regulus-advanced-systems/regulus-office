/**
 * `generateRoom` (#182, SPEC §9.1 "Room interiors", D8): a project room's
 * interior from its size, door side, desk count and decor style.
 *
 * Layout rules:
 * - Shell: the door where the compound puts it (two tiles, centred on its
 *   side); the wall facing it and one neighbour are full and carry the board
 *   wall, the other two are low stubs; the player spawns just inside the door.
 * - Desks: four-seat pods in a grid with a 2 m band along every wall and
 *   lanes of at least 2 m between columns and 1.8 m between rows; desks fill
 *   the slots nearest the wall facing the door first and never move (`slots.ts`).
 * - Board wall: every anchor kind on the back walls (`anchors.ts`).
 * - Props: vanilla cabinet, plant and lamp; three more per extra desk; a
 *   lounge nook in the last free slot; rugs and clutter (`props.ts`, `pods.ts`).
 * - Capacity: the most desks whose room keeps 75% of its interior free.
 *
 * The result is validated with `loadTemplate` (structure, reachability), so a
 * layout that leaves a seat or stand point unreachable throws.
 */
import { DECOR_STYLES, ROOM_MAX_TILES, ROOM_MIN_TILES } from "@regulus/protocol";
import { COMPASS_DIRECTIONS, ROOM_TIERS, type RoomTemplateInput, type RoomTier } from "../types.ts";
import { loadTemplate } from "../validate.ts";
import { hangBoardWall } from "./anchors.ts";
import { ROOM_MIN_FREE, ROOM_STUB_HEIGHT, ROOM_WALL_HEIGHT, TILE } from "./constants.ts";
import { roomLighting } from "./lighting.ts";
import { roomFreeFraction } from "./measure.ts";
import { addDesk, addNook, emptyFurnishing } from "./pods.ts";
import { PropPlanner, placeProps } from "./props.ts";
import { roomShell } from "./shell.ts";
import { podSlots } from "./slots.ts";
import { decorStyleSpec, styleModel } from "./styles.ts";
import type { GenerateRoomInput, RoomLayout } from "./types.ts";

export class RoomGenerationError extends RangeError {
  constructor(
    readonly code:
      | "bad_size"
      | "bad_door_side"
      | "bad_desk_count"
      | "too_many_desks"
      | "bad_decor_style",
    message: string,
  ) {
    super(message);
    this.name = "RoomGenerationError";
  }
}

/** Desk-tier label for the template `kind` (the scene only tells the lobby apart). */
function tierFor(seats: number): RoomTier {
  if (seats <= 6) return ROOM_TIERS[0];
  return seats <= 12 ? ROOM_TIERS[1] : ROOM_TIERS[2];
}

function checkInput(input: GenerateRoomInput): void {
  const { width, depth, doorSide, deskCount, decorStyle } = input;
  for (const n of [width, depth]) {
    if (!Number.isInteger(n) || n < ROOM_MIN_TILES || n > ROOM_MAX_TILES)
      throw new RoomGenerationError(
        "bad_size",
        `room size must be ${ROOM_MIN_TILES}..${ROOM_MAX_TILES} tiles, got ${width}x${depth}`,
      );
  }
  if (!(COMPASS_DIRECTIONS as readonly string[]).includes(doorSide))
    throw new RoomGenerationError("bad_door_side", `unknown door side "${doorSide}"`);
  if (!(DECOR_STYLES as readonly string[]).includes(decorStyle))
    throw new RoomGenerationError("bad_decor_style", `unknown decor style "${decorStyle}"`);
  if (!Number.isInteger(deskCount) || deskCount < 1)
    throw new RoomGenerationError("bad_desk_count", `desk count must be a positive integer`);
}

/** Build without the capacity check (used to find the capacity). */
function build(input: GenerateRoomInput, maxDeskCount: number): RoomLayout {
  const { width, depth, doorSide, deskCount, decorStyle } = input;
  const w = width * TILE;
  const d = depth * TILE;
  const style = decorStyleSpec(decorStyle);
  const shell = roomShell(w, d, doorSide);
  const grid = podSlots(width, depth, doorSide);
  const f = emptyFurnishing();
  const models: Record<string, string> = {};

  grid.slots.slice(0, deskCount).forEach((slot, i) => addDesk(f, i + 1, slot, style));
  const lamps: string[] = [];
  const spare = grid.slots[grid.slots.length - 1];
  if (deskCount > 1 && spare && deskCount < grid.slots.length) lamps.push(addNook(f, spare));

  const board = hangBoardWall(
    shell,
    w,
    d,
    Math.min(2, Math.floor((deskCount - 1) / 3)),
    style.wallDecor.slice(0, Math.min(4, deskCount - 1)),
  );
  const planner = new PropPlanner(shell, grid, w, d, board.free, style);
  lamps.push(...placeProps(planner, deskCount));
  for (const prop of planner.props) {
    f.obstacles.push(prop.obstacle);
    models[prop.obstacle.id] = prop.model;
  }

  for (const o of f.obstacles) models[o.id] ??= styleModel(style, o.kind);
  for (const s of f.seats)
    models[s.id] = styleModel(style, s.kind === "desk" ? "chair" : "armchair");
  for (const item of f.decor) models[item.id] = styleModel(style, item.kind);
  for (const item of board.wallDecor) models[item.id] = styleModel(style, item.kind);
  for (const a of board.anchors) models[a.id] = styleModel(style, a.kind);

  const seats = f.seats.filter((s) => s.kind === "desk").length;
  const raw: RoomTemplateInput = {
    id: `room-${width}x${depth}-${doorSide}-${deskCount}-${decorStyle}`,
    name: `Room ${width}×${depth}`,
    kind: tierFor(seats),
    size: { width: w, depth: d },
    wallHeight: ROOM_WALL_HEIGHT,
    stubHeight: ROOM_STUB_HEIGHT,
    walls: shell.walls,
    nameWallId: shell.nameWallId,
    seats: f.seats,
    wallAnchors: board.anchors,
    obstacles: f.obstacles,
    rugs: f.rugs,
    wallDecor: board.wallDecor,
    decor: f.decor,
    elevator: shell.elevator,
    spawn: shell.spawn,
  };
  const template = loadTemplate(raw);
  return {
    ...template,
    room: {
      width,
      depth,
      doorSide,
      deskCount,
      maxDeskCount,
      decorStyle,
      door: { wallId: shell.elevator.wallId, ...shell.door },
      desks: f.desks,
      materials: { floor: style.floorMaterial, wall: style.wallMaterial, palette: style.palette },
      lighting: roomLighting(style, f, board.anchors, shell.walls, lamps, f.obstacles),
      models,
    },
  };
}

const capacity = new Map<string, number>();

/**
 * Most desks a `width` × `depth` room fits: every pod slot, less any that
 * would leave under 75% of the interior free. Depends on the size only
 * (door side and style never change it).
 */
export function maxDeskCount(width: number, depth: number): number {
  const key = `${width}x${depth}`;
  const hit = capacity.get(key);
  if (hit !== undefined) return hit;
  checkInput({ width, depth, doorSide: "south", deskCount: 1, decorStyle: DECOR_STYLES[0] });
  let n = podSlots(width, depth, "south").slots.length;
  // Measured with every door side; the tightest one decides.
  for (; n > 1; n--) {
    const fits = COMPASS_DIRECTIONS.every((doorSide) => {
      const layout = build(
        { width, depth, doorSide, deskCount: n, decorStyle: DECOR_STYLES[0] },
        n,
      );
      return roomFreeFraction(layout) >= ROOM_MIN_FREE;
    });
    if (fits) break;
  }
  capacity.set(key, n);
  return n;
}

/** Generate a room interior. Throws `RoomGenerationError` on bad input. */
export function generateRoom(input: GenerateRoomInput): RoomLayout {
  checkInput(input);
  const max = maxDeskCount(input.width, input.depth);
  if (input.deskCount > max)
    throw new RoomGenerationError(
      "too_many_desks",
      `a ${input.width}x${input.depth} room fits at most ${max} desks, got ${input.deskCount}`,
    );
  return build(input, max);
}
