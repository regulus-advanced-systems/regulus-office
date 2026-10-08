/**
 * Where a personal agent stands while it follows its owner (#252): a polite
 * step behind and to one side of them, inside the room or corridor stretch
 * they are in, so the spot is never across a wall. When the owner is in a
 * project room the agent may not enter, it waits outside the door. Pure.
 */
import { LOBBY_OPERATION_ID, OFFICE_AGENT_POLITE_DISTANCE } from "@regulus/protocol";
import { headingToward, type Pose, type Vec2 } from "@regulus/room-layout";
import { clampInto, corridorAt, doorWait, type LairLevel, roomAt } from "./geometry.ts";

export interface FollowInput {
  level: LairLevel;
  owner: Pose;
  /** Where the owner was when the agent was last sent somewhere, if on this level. */
  from: Vec2 | null;
  /** 0 for a person's first agent, 1 for their second...: each takes its own place. */
  slot: number;
  /** May the agent be in this project room? (The office's operation access gate.) */
  mayEnter(operationId: string): boolean;
}

export interface FollowPlan {
  mode: "follow" | "wait";
  target: Pose;
  operationId: string;
  doing: string;
}

/** Off the walls of the room or corridor the owner is in, metres. */
const WALL_CLEARANCE = 0.55;
/** The owner moved less than this since last time: use the way they face instead. */
const MOVED_EPS = 0.2;

export function planFollow(input: FollowInput): FollowPlan {
  const { level, owner, slot } = input;
  const room = roomAt(level, owner);
  if (room?.kind === "project" && (!room.ready || !input.mayEnter(room.id))) {
    const door = doorWait(room);
    // Further agents line up along the corridor, a step apart.
    const side = slot === 0 ? 0 : (slot % 2 === 1 ? 1 : -1) * Math.ceil(slot / 2) * 0.9;
    const along = room.doorSide === "north" || room.doorSide === "south";
    return {
      mode: "wait",
      target: {
        x: door.x + (along ? side : 0),
        z: door.z + (along ? 0 : side),
        heading: door.heading,
      },
      operationId: LOBBY_OPERATION_ID,
      doing: "waiting at the door",
    };
  }
  // The way the owner is going (or facing when they have not moved).
  let dx = input.from ? owner.x - input.from.x : 0;
  let dz = input.from ? owner.z - input.from.z : 0;
  const moved = Math.hypot(dx, dz);
  if (moved < MOVED_EPS) {
    dx = -Math.sin(owner.heading);
    dz = -Math.cos(owner.heading);
  } else {
    dx /= moved;
    dz /= moved;
  }
  // Behind them, turned to one side; later agents fan out and stand a little further back.
  const ring = Math.floor(slot / 2);
  const angle = (slot % 2 === 0 ? 1 : -1) * (0.65 + 0.3 * ring);
  const distance = OFFICE_AGENT_POLITE_DISTANCE + 0.6 * ring;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const bx = -dx * cos + dz * sin;
  const bz = -dx * sin - dz * cos;
  const wanted = { x: owner.x + bx * distance, z: owner.z + bz * distance };
  const region = room?.rect ?? corridorAt(level, owner);
  // Outside every room and corridor (the beach): where the owner just came from is walkable.
  const spot = region ? clampInto(region, wanted, WALL_CLEARANCE) : (input.from ?? owner);
  return {
    mode: "follow",
    target: { x: spot.x, z: spot.z, heading: headingToward(spot, owner) },
    operationId: room?.kind === "project" ? room.id : LOBBY_OPERATION_ID,
    doing: "",
  };
}
