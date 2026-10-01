/**
 * Turns distance walked into footsteps: one step every `stride` metres,
 * tracked across frames. Pure so the cadence is unit-testable; the sound
 * and the reduced-motion check live in footsteps.ts.
 */

/** Metres between footsteps of a walking avatar (Quaternius walk cycle at ~2.4 m/s). */
export const STRIDE_METRES = 0.6;
/**
 * Metres between footsteps of a running avatar (#223): longer strides, but
 * at 2.2 times the speed they still come about 1.2 times as often, in step
 * with the genius run cycle (two steps per RUN_CYCLE_SECONDS).
 */
export const RUN_STRIDE_METRES = 1.1;

export interface FootstepCadence {
  /**
   * Feed the total distance walked so far; returns how many strides were
   * completed. `stride` overrides the cadence's stride from here on (a run).
   */
  advance(distanceWalked: number, stride?: number): number;
  reset(distanceWalked?: number): void;
}

export function createFootstepCadence(stride: number = STRIDE_METRES): FootstepCadence {
  if (!(stride > 0)) throw new Error("stride must be positive");
  let last = 0;
  let carried = 0;
  return {
    advance(distanceWalked, strideNow = stride) {
      const delta = distanceWalked - last;
      last = distanceWalked;
      if (!(delta > 0)) {
        // Going backwards (a respawn) restarts the count.
        if (delta < 0) carried = 0;
        return 0;
      }
      carried += delta;
      const length = strideNow > 0 ? strideNow : stride;
      const steps = Math.floor(carried / length);
      carried -= steps * length;
      return steps;
    },
    reset(distanceWalked = 0) {
      last = distanceWalked;
      carried = 0;
    },
  };
}
