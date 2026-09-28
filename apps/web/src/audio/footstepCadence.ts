/**
 * Turns distance walked into footsteps: one step every `stride` metres,
 * tracked across frames. Pure so the cadence is unit-testable; the sound
 * and the reduced-motion check live in footsteps.ts.
 */

/** Metres between footsteps of a walking avatar (Quaternius walk cycle at ~2.4 m/s). */
export const STRIDE_METRES = 0.6;

export interface FootstepCadence {
  /** Feed the total distance walked so far; returns how many strides were completed. */
  advance(distanceWalked: number): number;
  reset(distanceWalked?: number): void;
}

export function createFootstepCadence(stride: number = STRIDE_METRES): FootstepCadence {
  if (!(stride > 0)) throw new Error("stride must be positive");
  let last = 0;
  let carried = 0;
  return {
    advance(distanceWalked) {
      const delta = distanceWalked - last;
      last = distanceWalked;
      if (!(delta > 0)) {
        // Going backwards (a respawn) restarts the count.
        if (delta < 0) carried = 0;
        return 0;
      }
      carried += delta;
      const steps = Math.floor(carried / stride);
      carried -= steps * stride;
      return steps;
    },
    reset(distanceWalked = 0) {
      last = distanceWalked;
      carried = 0;
    },
  };
}
