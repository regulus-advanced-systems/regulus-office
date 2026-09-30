/**
 * Robots celebrate when the merge gong rings (#43). A seated robot dances in
 * its chair (the seated cheer clip, seatedClips.ts) for `CHEER_MS` and then
 * crossfades back to the clip its status/action wants: the still seated pose
 * for an idle robot (#159), typing for a working one. It never stands up or
 * moves on its seat, so it ends in exactly the pose it had. A robot showing
 * a standing one-shot (its own celebrate or facepalm) finishes that instead.
 * With reduced motion nobody cheers.
 *
 * Pure: `robotCheers` is fed the robot's look, the last ring and a clock.
 */
import { cheerActive, type GongRingView } from "../gong/timing.ts";
import type { RobotLook } from "./robotAnimation.ts";

export { CHEER_MS } from "../gong/timing.ts";

/** Whether the robot plays the seated cheer at `now`. */
export function robotCheers(
  look: Pick<RobotLook, "seated">,
  ring: Pick<GongRingView, "at"> | null,
  now: number,
  reducedMotion: boolean,
): boolean {
  return look.seated && cheerActive(ring, now, reducedMotion);
}
