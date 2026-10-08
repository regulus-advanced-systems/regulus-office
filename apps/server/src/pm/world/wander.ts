/**
 * Where an office agent on its own goes next (#252): another spot it may use,
 * mostly near where it is, sometimes in another room, then a pause there.
 * Pure: the random source is passed in.
 */
import { OFFICE_AGENT_WALK_SPEED } from "@regulus/protocol";
import type { Vec2 } from "@regulus/room-layout";
import type { Spot } from "./spots.ts";

/** How long it stays at a spot, ms. */
export const PAUSE_MIN_MS = 5_000;
export const PAUSE_MAX_MS = 14_000;
/** Chance to stay in the room or corridor it is in. */
const STAY_CHANCE = 0.45;
/** A spot this close to where it stands is not a walk. */
const MIN_WALK = 1.5;

export interface WanderPick {
  spot: Spot;
  /** When to pick again: the walk there (generously) plus the pause, ms from now. */
  after: number;
}

export function pickWander(
  spots: readonly Spot[],
  at: { levelId: string; place: string } & Vec2,
  random: () => number,
): WanderPick | null {
  const far = spots.filter(
    (s) => s.levelId !== at.levelId || Math.hypot(s.x - at.x, s.z - at.z) >= MIN_WALK,
  );
  if (far.length === 0) return null;
  const here = far.filter((s) => s.levelId === at.levelId && s.place === at.place);
  const sameLevel = far.filter((s) => s.levelId === at.levelId);
  let pool = far;
  if (here.length > 0 && random() < STAY_CHANCE) pool = here;
  else if (sameLevel.length > 0 && random() < 0.85) pool = sameLevel;
  const spot = pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))] as Spot;
  const walk =
    spot.levelId === at.levelId
      ? // The way round walls is longer than the straight line.
        ((Math.hypot(spot.x - at.x, spot.z - at.z) * 1.6) / OFFICE_AGENT_WALK_SPEED) * 1000
      : 0;
  const pause = PAUSE_MIN_MS + random() * (PAUSE_MAX_MS - PAUSE_MIN_MS);
  return { spot, after: walk + pause };
}

/** A stable number in [0, 1) from an id: each agent has its own home spot. */
export function unitHash(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10_000) / 10_000;
}
