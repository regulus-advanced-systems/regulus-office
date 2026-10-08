/**
 * Scripted routes (#252, #60): a list of stops a body is sent to one after the
 * other, each with a pause. A route is asked for its next stop only when the
 * body is done at the last one, so a route may decide late (the office PM
 * looks at who is waiting in a room when it gets to that room, rounds.ts).
 *
 * A stop inside a project room the agent may not enter (or that is not
 * built) is skipped: `nextStop` is the only reader, and it asks `mayEnter`
 * for every stop, whoever wrote the route. Pure.
 */
import { LOBBY_OPERATION_ID, OFFICE_AGENT_WALK_SPEED } from "@regulus/protocol";
import type { Pose, Vec2 } from "@regulus/room-layout";
import { centreOf, type Lair, type LairRoom, lobbyOf, roomAt } from "./geometry.ts";

/** A henchman the body goes to stand next to (the PM's rounds). */
export interface RouteVisit {
  henchmanId: string;
  ownerUserId: string;
}

export interface RouteStop extends Pose {
  levelId: string;
  /** A project room's operation id when the stop is inside one. */
  operationId?: string;
  doing?: string;
  /** How long to stay, ms. */
  pauseMs: number;
  visit?: RouteVisit;
}

export interface Route {
  /** The next stop to try; null when the route is over. */
  next(): RouteStop | null;
  /** How many stops to try before giving up for now (a route that never ends). */
  readonly tries: number;
}

/** A fixed list of stops walked round and round. */
export function loopRoute(stops: readonly RouteStop[]): Route {
  let index = -1;
  return {
    tries: stops.length,
    next() {
      if (stops.length === 0) return null;
      index = (index + 1) % stops.length;
      return stops[index] as RouteStop;
    },
  };
}

export interface NextStop {
  stop: RouteStop;
  /** The room the stop is in, if any. */
  room: LairRoom | null;
  /** What `OfficeAgentBody.operationId` becomes there. */
  operationId: string;
}

/**
 * The next stop of a route the agent may stand at. `"over"`: the route ended.
 * Null: nothing it may use right now (try again later).
 */
export function nextStop(
  route: Route,
  lair: Lair,
  mayEnter: (operationId: string) => boolean,
): NextStop | "over" | null {
  for (let tried = 0; tried < Math.max(1, route.tries); tried++) {
    const stop = route.next();
    if (!stop) return "over";
    const level = lair.levels.get(stop.levelId);
    if (!level) continue;
    const room = roomAt(level, stop);
    if (room?.kind === "project" && (!room.ready || !mayEnter(room.id))) continue;
    return { stop, room, operationId: room?.kind === "project" ? room.id : LOBBY_OPERATION_ID };
  }
  return null;
}

/**
 * How long a body takes to get from where it was sent last to a stop, ms:
 * the way round walls is longer than the straight line. On another level it
 * arrives where the lift does and walks from there.
 */
export function walkMs(
  lair: Lair,
  from: Vec2 & { levelId: string },
  to: Vec2 & { levelId: string },
): number {
  let start: Vec2 = from;
  let ride = 0;
  if (from.levelId !== to.levelId) {
    const arrival = lobbyOf(lair.levels.get(to.levelId));
    start = arrival ? centreOf(arrival.rect) : to;
    ride = 1_500;
  }
  const metres = Math.hypot(to.x - start.x, to.z - start.z) * 1.6;
  return ride + (metres / OFFICE_AGENT_WALK_SPEED) * 1_000;
}
