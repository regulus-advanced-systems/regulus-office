/**
 * The reception desk in the lobby (SPEC §9.1; #60): the office PM's home
 * post. One place for its numbers, shared by the server (which sends the PM
 * to its post) and the client (which draws the desk and lets a visitor walk
 * up and press `E`), in the lobby's own frame: metres from its north-west
 * corner. The desk stands against the west wall and faces the room.
 */
import { HEADING, type Pose, type Rect, type Vec2 } from "../geometry.ts";

export interface ReceptionSpec {
  /** Footprint of the counter (it blocks the nav grid). */
  desk: Rect;
  /** The swivel chair behind it. */
  chair: Vec2;
  /** Where the PM stands at its post: behind the counter, next to the chair, facing the room. */
  post: Pose;
  /** Where a visitor stands to talk across the counter. */
  visitor: Pose;
}

/** A visitor this close to the visitor spot is "at the desk", metres. */
export const RECEPTION_REACH = 1.8;

export function receptionSpec(_w: number, d: number): ReceptionSpec {
  const desk = { x: 1.4, z: d / 2 - 3, w: 1.3, d: 5 };
  return {
    desk,
    chair: { x: 0.95, z: d / 2 - 0.5 },
    post: { x: 0.85, z: d / 2 + 0.8, heading: HEADING.east },
    visitor: { x: desk.x + desk.w + 0.9, z: d / 2 + 0.3, heading: HEADING.west },
  };
}
