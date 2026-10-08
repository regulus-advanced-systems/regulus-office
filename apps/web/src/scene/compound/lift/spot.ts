/**
 * Where the lift stands on the level being looked at (#269): the lobby and
 * every landing have it at the same spot (`@regulus/room-layout` lift.ts),
 * here in compound metres with the room it is in.
 */
import { type LiftSpot, liftSpotIn } from "@regulus/room-layout";
import { arrivalRoomOf, type CompoundWorld, type WorldRoom } from "../world.ts";

export interface WorldLift extends LiftSpot {
  room: WorldRoom;
}

/** From this far (metres) from the spot in front of the door, `E` calls the lift. */
export const LIFT_REACH = 1.7;

export function liftOf(world: CompoundWorld): WorldLift | null {
  const room = arrivalRoomOf(world);
  return room ? { ...liftSpotIn(room.rect), room } : null;
}

/** True when a player at `p` stands at the lift's door. */
export function atLift(lift: WorldLift, p: { x: number; z: number }): boolean {
  return Math.hypot(p.x - lift.stand.x, p.z - lift.stand.z) <= LIFT_REACH;
}
