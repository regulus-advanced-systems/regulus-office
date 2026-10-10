/**
 * Moving an office agent's body (#252, #269; split from world.ts): where it
 * first appears, the one place a body is sent somewhere, and one step of a
 * scripted route. `AgentWorld` decides where a body goes; this does the going.
 */
import {
  LOBBY_LEVEL_ID,
  LOBBY_OPERATION_ID,
  OFFICE_AGENT_DOING_MAX,
  type OfficeAgentBodyMode,
  type OfficeAgentBodySchema,
} from "@regulus/protocol";
import type { Pose } from "@regulus/room-layout";
import { type Lair, liftArrival, lobbyOf } from "./geometry.ts";
import { type NextStop, nextStop, type Route, type RouteVisit, walkMs } from "./route.ts";
import { roomSpots, type Spot } from "./spots.ts";
import { unitHash } from "./wander.ts";

export type Body = InstanceType<typeof OfficeAgentBodySchema>;

export interface Brain {
  /** Wander and route: when to pick the next spot. */
  nextAt: number;
  /** Follow: where the owner was (and on which level) when the agent was last sent. */
  anchor: { levelId: string; x: number; z: number } | null;
  /** The room or corridor of its spot (spots.ts `place`). */
  place: string;
  route: Route | null;
  /** On a route: the henchman it is walking up to, and when it gets there. */
  arrival: { at: number; visit: RouteVisit } | null;
  /** On a route: the stop it goes on to once it has stepped out of the lift. */
  pending: NextStop | null;
}

/** Where an agent first appears: its own spot in the lobby, the same after every restart. */
export function homeSpot(agentId: string, lair: Lair): Spot {
  const lobby = lobbyOf(lair.levels.get(LOBBY_LEVEL_ID));
  const spots = lobby ? roomSpots(lobby) : [];
  const spot = spots[Math.floor(unitHash(agentId) * spots.length)];
  return (
    spot ?? {
      x: 0,
      z: 0,
      heading: 0,
      levelId: LOBBY_LEVEL_ID,
      operationId: LOBBY_OPERATION_ID,
      place: LOBBY_OPERATION_ID,
      doing: "",
    }
  );
}

/**
 * The one place a body is sent somewhere. `hop` places it there at once
 * instead of walking (its first appearance). A change of level never goes
 * straight to `to`: the body is placed by the lift on the new level's landing
 * (the lobby on the lobby level), where people who ride the lift step out
 * (#269), and `byLift` is true, so the caller sends it on from there, on
 * foot, at its next step. No ride is played for it. `placed` is true when the
 * body changed room or level: who may see it has changed.
 */
export function sendBody(
  lair: Lair | null,
  body: Body,
  mode: OfficeAgentBodyMode,
  to: Pose & { levelId: string; operationId: string },
  options: { hop?: boolean; doing?: string } = {},
): { byLift: boolean; placed: boolean } {
  let target: Pose = to;
  let operationId = to.operationId;
  let doing = options.doing ?? "";
  let byLift = false;
  let placed = false;
  if (body.levelId !== to.levelId) {
    const arrival = options.hop
      ? null
      : liftArrival(lair?.levels.get(to.levelId), unitHash(body.agentId));
    body.levelId = to.levelId;
    body.hop += 1;
    placed = true;
    if (arrival) {
      target = arrival;
      operationId = LOBBY_OPERATION_ID;
      doing = "stepping out of the lift";
      byLift = true;
    }
  } else if (options.hop) body.hop += 1;
  if (body.mode !== mode) body.mode = mode;
  if (body.operationId !== operationId) {
    body.operationId = operationId;
    placed = true;
  }
  doing = doing.slice(0, OFFICE_AGENT_DOING_MAX);
  if (body.doing !== doing) body.doing = doing;
  const t = body.target;
  if (t.x !== target.x) t.x = target.x;
  if (t.z !== target.z) t.z = target.z;
  if (t.heading !== target.heading) t.heading = target.heading;
  return { byLift, placed };
}

/** One step of a body on a scripted route. `send` returns true when it stepped out of a lift. */
export function stepRoute(
  body: Body,
  brain: Brain,
  lair: Lair,
  mayEnter: (operationId: string) => boolean,
  now: number,
  send: (to: Pose & { levelId: string; operationId: string }, doing: string) => boolean,
): void {
  const route = brain.route;
  if (!route || now < brain.nextAt) return;
  // A stop it was on its way to when it changed level, else the route's next one.
  const next = brain.pending ?? nextStop(route, lair, mayEnter);
  brain.pending = null;
  if (next === "over") {
    brain.route = null;
    return;
  }
  if (!next || (next.room?.kind === "project" && !mayEnter(next.room.id))) {
    // Nothing it may stand at right now: it stays where it is.
    brain.nextAt = now + (next ? 0 : 5_000);
    return;
  }
  const { stop } = next;
  const walk = walkMs(body.target, stop);
  if (send({ ...stop, operationId: next.operationId }, stop.doing ?? "")) {
    // Out of the lift on the stop's level: walk to this same stop next.
    brain.pending = next;
    brain.place = "";
    brain.nextAt = now + 2_000;
    return;
  }
  brain.place = next.room?.id ?? "";
  brain.arrival = stop.visit ? { at: now + walk, visit: stop.visit } : null;
  brain.nextAt = now + walk + stop.pauseMs;
}
