/**
 * Places an office agent on its own goes to (#252): in front of a room's
 * boards, screens and pictures, by its seats, across its floor, and along the
 * corridors. Each spot carries a few words for the bubble ("studying the
 * issue board"); they describe the place, never the agent's work. Pure.
 */
import { LOBBY_OPERATION_ID } from "@regulus/protocol";
import {
  anchorStandPose,
  isHumanSeat,
  type Pose,
  projectRoomLayout,
  type Seat,
  specialRoomSeats,
  type WallAnchorKind,
  wallById,
} from "@regulus/room-layout";
import { centreOf, clampInto, type LairLevel, type LairRoom } from "./geometry.ts";

export interface Spot extends Pose {
  levelId: string;
  /** The room it is in: a project room's operation id, else the lobby's id. */
  operationId: string;
  /** The room or corridor it belongs to, for "somewhere else next time". */
  place: string;
  doing: string;
}

const ANCHOR_WORDS: Readonly<Record<WallAnchorKind, string>> = {
  issue_board: "studying the issue board",
  pr_board: "studying the PR board",
  queue_clipboard: "checking the queue",
  whiteboard: "pondering the whiteboard",
  usage_wall: "watching the usage wall",
  tv: "watching the screen",
  picture: "admiring a picture",
  gong: "eyeing the gong",
};

const FLOOR_WORDS: Readonly<Record<LairRoom["kind"], string>> = {
  lobby: "patrolling the lobby",
  conference: "inspecting the war room",
  break_room: "checking the break room",
  landing: "patrolling the landing",
  project: "looking over the crew",
};

const SEAT_WORDS: Readonly<Record<LairRoom["kind"], string>> = {
  lobby: "loitering by the lounge",
  conference: "eyeing the war table",
  break_room: "hovering by the snacks",
  landing: "waiting by the lift",
  project: "resting by the lounge",
};

/** How far in front of a seat a body stands, and how far off the walls a floor spot is, metres. */
const SEAT_STAND = 0.95;
const FLOOR_INSET = 1.6;

/** In front of a seat, facing it. */
function bySeat(seat: Seat): Pose {
  const h = seat.pose.heading;
  return {
    x: seat.pose.x - Math.sin(h) * SEAT_STAND,
    z: seat.pose.z - Math.cos(h) * SEAT_STAND,
    heading: h + Math.PI,
  };
}

/** The spots of one room, compound metres, all inside its footprint. */
export function roomSpots(room: LairRoom): Spot[] {
  const operationId = room.kind === "project" ? room.id : LOBBY_OPERATION_ID;
  const base = { levelId: room.levelId, operationId, place: room.id };
  const out: Spot[] = [];
  const add = (local: Pose, doing: string) => {
    // Never outside the room it belongs to, whatever the layout says.
    const p = clampInto(room.rect, { x: room.rect.x + local.x, z: room.rect.z + local.z }, 0.5);
    out.push({ ...base, x: p.x, z: p.z, heading: local.heading, doing });
  };
  let seats: Seat[] = [];
  if (room.kind === "project") {
    const layout = projectRoomLayout({
      width: room.tiles.w,
      depth: room.tiles.d,
      doorSide: room.doorSide,
      deskCount: room.deskCount,
      decorStyle: room.decorStyle,
    });
    for (const anchor of layout?.wallAnchors ?? []) {
      const wall = layout ? wallById(layout, anchor.wallId) : undefined;
      if (wall) add(anchorStandPose(wall, anchor), ANCHOR_WORDS[anchor.kind]);
    }
    seats = (layout?.seats ?? []).filter(isHumanSeat);
  } else seats = specialRoomSeats(room.kind, room.rect.w, room.rect.d);
  // One spot per piece of furniture, not one per cushion.
  const seen = new Set<string>();
  for (const seat of seats) {
    const group = seat.id.replace(/-\d+\w?$/, "");
    if (seen.has(group)) continue;
    seen.add(group);
    add(bySeat(seat), SEAT_WORDS[room.kind]);
  }
  // A few places on the open floor, facing the middle of the room.
  const c = { x: room.rect.w / 2, z: room.rect.d / 2 };
  for (const [fx, fz] of [
    [0.25, 0.3],
    [0.75, 0.3],
    [0.5, 0.72],
  ] as const) {
    const x = Math.min(room.rect.w - FLOOR_INSET, Math.max(FLOOR_INSET, room.rect.w * fx));
    const z = Math.min(room.rect.d - FLOOR_INSET, Math.max(FLOOR_INSET, room.rect.d * fz));
    add({ x, z, heading: Math.atan2(x - c.x, z - c.z) }, FLOOR_WORDS[room.kind]);
  }
  return out;
}

/** A spot in the middle of each corridor stretch long enough to stroll along. */
export function corridorSpots(level: LairLevel): Spot[] {
  return level.corridors
    .filter((r) => Math.max(r.w, r.d) >= 8)
    .map((r, i) => ({
      ...centreOf(r),
      heading: r.w >= r.d ? Math.PI / 2 : 0,
      levelId: level.levelId,
      operationId: LOBBY_OPERATION_ID,
      place: `corridor-${i}`,
      doing: "patrolling the corridor",
    }));
}

/**
 * Every spot of a level an agent may use: the fixed rooms and corridors, and
 * the finished project rooms `mayEnter` allows.
 */
export function levelSpots(level: LairLevel, mayEnter: (operationId: string) => boolean): Spot[] {
  const out: Spot[] = [];
  for (const room of level.rooms) {
    if (room.kind === "project" && (!room.ready || !mayEnter(room.id))) continue;
    out.push(...roomSpots(room));
  }
  out.push(...corridorSpots(level));
  return out;
}
