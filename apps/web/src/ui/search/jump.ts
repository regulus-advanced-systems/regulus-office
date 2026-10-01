/**
 * Jump-to-desk from a search result (#41), as a pure step function: given
 * where the player is and what the scene has loaded, what to do next.
 *
 *   another operation  → quick travel into its room (#186) once, then wait
 *   operation loading  → wait for the operation state and the respawn on it
 *   on the operation   → walk to the henchman's desk (click-to-walk pathing)
 *   at the desk    → open the terminal (also when the walk ends or stalls)
 *
 * The driver (useSearchJump.ts) samples the stores and applies the step.
 */

export interface JumpTarget {
  agentId: string;
  operationId: string;
  /** The henchman's desk seat from the search result; the live operation state wins. */
  seatId?: string;
  docId: number;
  /** The query, so the terminal can show the match. */
  query: string;
  startedAt: number;
}

export interface JumpWorld {
  now: number;
  /** Operation we are on or joining (operation store). */
  operationId: string | null;
  /** The OperationRoom state of the target operation is in. */
  operationLoaded: boolean;
  /** The avatar respawned on the target operation and its nav grid is ready. */
  playerReady: boolean;
  player: { x: number; z: number };
  /** The avatar is following a path. */
  walking: boolean;
  /** The henchman's desk seat position, when the template has it. */
  seat: { x: number; z: number } | null;
}

export interface JumpProgress {
  rode: boolean;
  walkingSince: number | null;
}

export type JumpStep =
  | { kind: "ride" }
  | { kind: "wait" }
  | { kind: "walk"; to: { x: number; z: number } }
  | { kind: "open" }
  | { kind: "give_up" };

/** Close enough to the desk: the same reach as `E` at a desk. */
export const ARRIVE_RADIUS = 1.6;
/** A walk that has not arrived by then opens the terminal anyway. */
export const WALK_TIMEOUT_MS = 12_000;
/** The whole jump, travel included. */
export const JUMP_TIMEOUT_MS = 25_000;

export function nextJumpStep(
  target: JumpTarget,
  world: JumpWorld,
  progress: JumpProgress,
): JumpStep {
  const onOperation = world.operationId === target.operationId;
  if (world.now - target.startedAt > JUMP_TIMEOUT_MS)
    return onOperation ? { kind: "open" } : { kind: "give_up" };
  if (!onOperation) return progress.rode ? { kind: "wait" } : { kind: "ride" };
  if (!world.operationLoaded || !world.playerReady) return { kind: "wait" };
  if (!world.seat) return { kind: "open" };
  const d = Math.hypot(world.player.x - world.seat.x, world.player.z - world.seat.z);
  if (d <= ARRIVE_RADIUS) return { kind: "open" };
  if (progress.walkingSince === null) return { kind: "walk", to: world.seat };
  if (!world.walking) return { kind: "open" };
  if (world.now - progress.walkingSince > WALK_TIMEOUT_MS) return { kind: "open" };
  return { kind: "wait" };
}
