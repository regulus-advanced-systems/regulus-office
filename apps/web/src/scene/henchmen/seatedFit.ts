/**
 * Where the seated henchman's body is relative to its avatar origin, in the
 * still seated pose (`Henchman|SitIdle`, poses.ts), in metres: the
 * henchman's counterpart of avatar/seatedFit.ts (#163). Checked against the
 * built model by seating.glb.test.ts.
 *
 * The seated clip keeps the Hips bone straight above the origin, so the
 * henchman's placement only lifts it onto the cushion and moves it forward of
 * the backrest (`seatedOffset(anchor, HENCHMAN_SEATED_BODY)`).
 */
import type { SeatedBody } from "../avatar/seatedFit.ts";
import { SEAT_HIPS_Y } from "./poses.ts";

export const HENCHMAN_SEATED_BODY: SeatedBody = {
  hips: { up: SEAT_HIPS_Y, back: 0 },
  /** The underside of the torso and thighs, below the Hips bone. */
  sitDrop: 0.105,
  /** The back of the torso (below the chest), behind the Hips bone. */
  backDepth: 0.1,
};

/** The front of the torso (the belly), ahead of the Hips bone; the knees go under the table. */
export const HENCHMAN_SEATED_FRONT = 0.1;
