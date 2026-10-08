/**
 * The lift (SPEC §14 D26; #269): one shaft through the mountain, so it stands
 * at the same spot of the lobby and of every level's landing (they share a
 * footprint): against the east wall, its door facing west into the room.
 * Shared by the scene (the art, the nav obstacle, where `E` calls it) and by
 * travel (where an arriving player appears), in the room's own frame.
 */
import type { DoorSide, TileRect } from "@regulus/protocol";
import { COMPOUND_TILE_METRES } from "@regulus/protocol";
import { HEADING, type Pose, type Rect } from "../geometry.ts";

/** The shaft housing: how far it stands out from the wall and how wide it is along it, metres. */
export const LIFT_SIZE = { out: 2.4, along: 3.2 } as const;
/** How far in front of the lift's door an arriving player stands, metres. */
export const LIFT_STAND_OFF = 1.3;

export interface LiftSpot {
  /** The housing's footprint (blocks the nav grid). */
  rect: Rect;
  /** The way its door faces. */
  facing: DoorSide;
  /** Middle of the doorway on the housing's front face. */
  door: { x: number; z: number };
  /** In front of the door, facing away from the lift: where a rider steps out. */
  stand: Pose;
}

/** The lift of a lobby or landing of `w × d` metres, room frame. */
export function liftSpot(w: number, d: number): LiftSpot {
  const { out, along } = LIFT_SIZE;
  // North of the lounge, clear of the jukebox's spot on the north wall.
  const z = Math.max(1.6, Math.min(4.4, d - along - 1.6));
  const rect: Rect = { x: w - out - 0.1, z, w: out, d: along };
  const door = { x: rect.x, z: rect.z + along / 2 };
  return {
    rect,
    facing: "west",
    door,
    stand: { x: door.x - LIFT_STAND_OFF, z: door.z, heading: HEADING.west },
  };
}

/** The same lift in compound metres, for the room on tile rectangle `room`. */
export function liftSpotIn(room: TileRect): LiftSpot {
  const m = COMPOUND_TILE_METRES;
  const spot = liftSpot(room.w * m, room.d * m);
  const ox = room.x * m;
  const oz = room.y * m;
  return {
    rect: { ...spot.rect, x: spot.rect.x + ox, z: spot.rect.z + oz },
    facing: spot.facing,
    door: { x: spot.door.x + ox, z: spot.door.z + oz },
    stand: { ...spot.stand, x: spot.stand.x + ox, z: spot.stand.z + oz },
  };
}
