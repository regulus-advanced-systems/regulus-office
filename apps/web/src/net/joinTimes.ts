/**
 * How long OperationRoom joins take (#190 perf gate): from asking to join to the
 * first state in hand. `OperationLinks` records every successful join here; the
 * perf probe (`?stats`) publishes the recent ones.
 */

export interface JoinTime {
  operationId: string;
  ms: number;
  /** When the join finished, `performance.now()`. */
  at: number;
}

const MAX = 50;
const log: JoinTime[] = [];

export function recordJoin(operationId: string, ms: number, at: number): void {
  log.push({ operationId, ms: Math.round(ms), at: Math.round(at) });
  if (log.length > MAX) log.shift();
}

export function recentJoins(): JoinTime[] {
  return [...log];
}
