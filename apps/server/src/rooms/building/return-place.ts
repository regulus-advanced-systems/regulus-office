/**
 * Coming back where you left (#262; SPEC §14 D26, D27, D34): the place a
 * person last stood is remembered, but it is only a wish. When they join,
 * this module decides whether they may stand there now, with the answer the
 * access gate gives for walking in (`LairView`, viewers.ts) and the level's
 * own nav grid:
 *
 * - the level must be one they reach, and still shown;
 * - a spot inside a project room needs that room to be the remembered one,
 *   finished, and open to them; a spot anywhere else must be remembered as
 *   "in no project room";
 * - the spot must be floor, and reachable on foot from where people arrive on
 *   that level, with every door shut that is shut for them. So a spot inside
 *   a wall, in the rock, in a room sealed to them, or on the beach behind a
 *   closed blast door is refused whatever was stored.
 *
 * The answer is yes or no and nothing else: a room that was deleted, moved,
 * archived or closed to them all read the same, so nothing can be told from
 * it. Pure.
 */
import {
  BLAST_DOOR_PHASES,
  blastDoorPassable,
  COMPOUND_TILE_METRES,
  DOOR_SIDES,
  type DoorSide,
  isOneOf,
  LOBBY_LEVEL_ID,
  LOBBY_OPERATION_ID,
} from "@regulus/protocol";
import {
  buildCompoundNavGrid,
  type Cell,
  type CompoundNavInput,
  type NavGrid,
} from "@regulus/room-layout";
import type { LairView } from "../../operations/access.ts";
import { isInsideWorld, wrapHeading } from "./commands.ts";

/** Where a person stands: the level, the project room (or the lobby id) and the pose. */
export interface ReturnPlace {
  levelId: string;
  operationId: string;
  x: number;
  z: number;
  heading: number;
}

interface RoomLike {
  gridX: number;
  gridY: number;
  width: number;
  depth: number;
  doorSide: string;
  doorX: number;
  doorY: number;
}

interface CompoundLike {
  width: number;
  depth: number;
  tileMetres: number;
  outsideDepth: number;
  blastDoorX: number;
  blastDoorY: number;
  blastDoorWidth: number;
  specialRooms: Iterable<RoomLike & { kind: string }>;
  corridors: Iterable<{ x: number; y: number; w: number; d: number }>;
}

/** The slice of the BuildingRoom state a place is checked against (schema or plain objects). */
export interface ReturnWorld {
  compound: CompoundLike;
  levels: { get(levelId: string): { compound: CompoundLike } | undefined };
  operations: {
    forEach(
      fn: (room: RoomLike & { operationId: string; levelId: string; buildState: string }) => void,
    ): void;
  };
  blastDoor: { phase: string };
}

const isDoorSide = isOneOf(DOOR_SIDES);
const isPhase = isOneOf(BLAST_DOOR_PHASES);
/** An unknown phase is a shut door. */
const doorOpen = (phase: string): boolean => isPhase(phase) && blastDoorPassable(phase);

/**
 * Nav cell edge, metres: the fine cell the clients walk on (apps/web
 * scene/compound/navigation.ts), so a spot a client could walk to beside a
 * wall is not refused here for falling in a coarser wall cell.
 */
export const RETURN_CELL_METRES = 0.25;

type NavRoom = CompoundNavInput["rooms"][number];

function navRoom(id: string, r: RoomLike): NavRoom | null {
  if (r.gridX < 0 || r.gridY < 0 || r.width <= 0 || r.depth <= 0 || !isDoorSide(r.doorSide))
    return null;
  return {
    id,
    rect: { x: r.gridX, y: r.gridY, w: r.width, d: r.depth },
    doorSide: r.doorSide as DoorSide,
    door: { x: r.doorX, y: r.doorY },
  };
}

/** Half-open, like the client's `roomAt`: a shared edge belongs to one room only. */
const holds = (room: NavRoom, m: number, x: number, z: number): boolean =>
  x >= room.rect.x * m &&
  x < (room.rect.x + room.rect.w) * m &&
  z >= room.rect.y * m &&
  z < (room.rect.y + room.rect.d) * m;

/**
 * Is there a way on foot between two cells? A plain breadth-first walk over
 * the floor, started at the spot being checked: one shut in a sealed room or
 * on the beach runs out of floor at once. Steps are along the grid only; the
 * nav grid allows a diagonal step only where both straight ones are floor, so
 * the answer is the one a walking client gets.
 */
function canWalk(grid: NavGrid, start: Cell, goal: Cell): boolean {
  if (!grid.isCellWalkable(start) || !grid.isCellWalkable(goal)) return false;
  const { cols } = grid;
  const target = grid.index(goal);
  const seen = new Uint8Array(grid.size);
  const queue = new Int32Array(grid.size);
  let head = 0;
  let tail = 0;
  queue[tail++] = grid.index(start);
  seen[grid.index(start)] = 1;
  while (head < tail) {
    const at = queue[head++] as number;
    if (at === target) return true;
    const col = at % cols;
    const row = (at - col) / cols;
    for (const [dc, dr] of STEPS) {
      const next = { col: col + dc, row: row + dr };
      if (!grid.isCellWalkable(next)) continue;
      const index = grid.index(next);
      if (seen[index]) continue;
      seen[index] = 1;
      queue[tail++] = index;
    }
  }
  return false;
}

const STEPS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

/**
 * The remembered place as it may be taken up now, or null when the person
 * must arrive in the lobby instead. `view` is what the access gate says they
 * may see at this moment.
 */
export function placeToReturnTo(
  world: ReturnWorld,
  view: LairView,
  wish: ReturnPlace,
): ReturnPlace | null {
  const { levelId, operationId, x, z, heading } = wish;
  if (![x, z, heading].every(Number.isFinite) || !isInsideWorld(x, z)) return null;
  if (!view.levels.has(levelId)) return null;
  const compound =
    world.levels.get(levelId)?.compound ?? (levelId === LOBBY_LEVEL_ID ? world.compound : null);
  if (!compound || compound.width <= 0) return null;
  const m = compound.tileMetres || COMPOUND_TILE_METRES;

  // The level as this person walks it: its fixed rooms, and its project rooms with
  // the door shut on every room that is not finished or not open to them.
  const rooms: NavRoom[] = [];
  let arrival: NavRoom | null = null;
  for (const special of compound.specialRooms) {
    const room = navRoom(special.kind, special);
    if (!room) continue;
    rooms.push(room);
    if (special.kind === "lobby" || special.kind === "landing") arrival ??= room;
  }
  if (!arrival) return null;
  const projects = new Map<string, NavRoom>();
  const shut = new Set<string>();
  world.operations.forEach((op) => {
    if (op.operationId === LOBBY_OPERATION_ID || op.levelId !== levelId) return;
    const room = navRoom(op.operationId, op);
    if (!room) return;
    rooms.push(room);
    projects.set(op.operationId, room);
    if (op.buildState !== "ready" || !view.rooms.has(op.operationId)) shut.add(op.operationId);
  });

  // The room is read from the spot, never taken on trust; it must be the remembered one.
  const here = [...projects.values()].find((room) => holds(room, m, x, z));
  if ((here?.id ?? LOBBY_OPERATION_ID) !== operationId) return null;
  if (here && shut.has(here.id)) return null;

  const grid = buildCompoundNavGrid(
    {
      width: compound.width,
      depth: compound.depth,
      outsideDepth: compound.outsideDepth,
      rooms,
      corridors: [...compound.corridors],
      blastDoor: { x: compound.blastDoorX, y: compound.blastDoorY, width: compound.blastDoorWidth },
    },
    {
      cellSize: RETURN_CELL_METRES,
      closedDoors: shut,
      blastDoorOpen: levelId === LOBBY_LEVEL_ID && doorOpen(world.blastDoor.phase),
    },
  );
  const from = grid.worldToCell(
    (arrival.rect.x + arrival.rect.w / 2) * m,
    (arrival.rect.y + arrival.rect.d / 2) * m,
  );
  const cell = grid.worldToCell(x, z);
  if (!grid.isCellWalkable(cell)) return null;
  if (!canWalk(grid, cell, from)) return null;
  return { levelId, operationId, x, z, heading: wrapHeading(heading) };
}
