/**
 * How long FloorRoom joins take (#190 perf gate): from asking to join to the
 * first state in hand. `FloorLinks` records every successful join here; the
 * perf probe (`?stats`) publishes the recent ones.
 */

export interface JoinTime {
  floorId: string;
  ms: number;
  /** When the join finished, `performance.now()`. */
  at: number;
}

const MAX = 50;
const log: JoinTime[] = [];

export function recordJoin(floorId: string, ms: number, at: number): void {
  log.push({ floorId, ms: Math.round(ms), at: Math.round(at) });
  if (log.length > MAX) log.shift();
}

export function recentJoins(): JoinTime[] {
  return [...log];
}
