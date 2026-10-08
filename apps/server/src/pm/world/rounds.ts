/**
 * The office PM in the world (SPEC §10 M5 "patrol route, visits waiting
 * henchmen", D28; #60): its post at the reception desk, and its rounds.
 *
 * At fixed times of the clock (every quarter of an hour by default) the PM
 * leaves reception and walks the project rooms it was granted, level by
 * level: it looks at the issue and PR boards of each room and stands for a
 * moment next to every henchman there that waits for its owner or has
 * finished, then goes back to its desk. Which rooms, and in which order,
 * follows from the clock and the grants alone, so a round is the same
 * whoever looks and whenever the office was started.
 *
 * Movement and presence only: nothing here calls a model, a tool or GitHub,
 * or reads anything of a repo. What it knows of a henchman is what the room
 * already shows everyone in it: its name, its owner's name, and whether it
 * waits or is done. A room outside the grants is never in a round, and
 * route.ts checks every stop again when the PM gets to it.
 */
import {
  type AgentStatus,
  LOBBY_LEVEL_ID,
  LOBBY_OPERATION_ID,
  PM_ROUND_EVERY_MS,
  PM_ROUND_FULL_STOPS_MS,
} from "@regulus/protocol";
import {
  anchorStandPose,
  type Pose,
  projectRoomLayout,
  type RoomLayout,
  receptionSpec,
  type Seat,
  wallById,
} from "@regulus/room-layout";
import { centreOf, clampInto, type Lair, type LairRoom, lobbyOf } from "./geometry.ts";
import type { Route, RouteStop } from "./route.ts";
import type { DutyContext, WorldAgent } from "./types.ts";

/** A henchman the PM stops by, as the room shows it. */
export interface RoundHenchman {
  agentId: string;
  name: string;
  operationId: string;
  seatId: string;
  ownerUserId: string;
  ownerName: string;
  /** Waiting for its owner (a permission or an answer), or done with its hand up. */
  state: "waiting" | "finished";
}

/** A henchman as the rounds see it; null for one that neither waits nor has its hand up. */
export function roundHenchmanOf(view: {
  agentId: string;
  name: string;
  operationId: string;
  seatId: string;
  ownerUserId: string;
  ownerName: string;
  status: AgentStatus;
  seen: boolean;
}): RoundHenchman | null {
  const waiting = view.status === "waiting_permission" || view.status === "waiting_input";
  if (!waiting && !(view.status === "done" && !view.seen)) return null;
  const { agentId, name, operationId, seatId, ownerUserId, ownerName } = view;
  return {
    agentId,
    name,
    operationId,
    seatId,
    ownerUserId,
    ownerName,
    state: waiting ? "waiting" : "finished",
  };
}

/** A round sets off within this long after its time, or not at all, ms. */
export const ROUND_START_WINDOW_MS = 60_000;
/** Rooms in one round; a bigger office is covered over the following rounds. */
export const ROUND_MAX_ROOMS = 12;
/** Henchmen it stops by in one room. */
export const ROUND_MAX_VISITS = 6;
export const BOARD_PAUSE_MS = 4_000;
export const WAITING_PAUSE_MS = 8_000;
export const FINISHED_PAUSE_MS = 5_000;
/** How far from a henchman's chair it stands, metres. */
const BESIDE = 0.95;

/**
 * How long the stops of a round are, as a share of the full pauses: rounds less
 * than two minutes apart keep them shorter in proportion, down to a quarter.
 */
export const stopPace = (everyMs: number): number =>
  Math.min(1, Math.max(0.25, everyMs / PM_ROUND_FULL_STOPS_MS));

/** The number of the round the clock is in. */
export const roundSlot = (now: number, everyMs: number): number => Math.floor(now / everyMs);

/** Where the office PM stands at reception, compound metres; null while the lobby is not there. */
export function receptionPost(
  lair: Lair,
): (Pose & { levelId: string; operationId: string }) | null {
  const lobby = lobbyOf(lair.levels.get(LOBBY_LEVEL_ID));
  if (!lobby) return null;
  const { post } = receptionSpec(lobby.rect.w, lobby.rect.d);
  return {
    x: lobby.rect.x + post.x,
    z: lobby.rect.z + post.z,
    heading: post.heading,
    levelId: LOBBY_LEVEL_ID,
    operationId: LOBBY_OPERATION_ID,
  };
}

/**
 * The rooms of round `slot`: every finished project room the agent may enter,
 * the lobby level first and then level by level, rooms by id. With more rooms
 * than one round holds, each round starts where the last one stopped.
 */
export function roundRooms(
  lair: Lair,
  mayEnter: (operationId: string) => boolean,
  slot: number,
): LairRoom[] {
  const levels = [...lair.levels.keys()].sort((a, b) =>
    a === LOBBY_LEVEL_ID ? -1 : b === LOBBY_LEVEL_ID ? 1 : a.localeCompare(b),
  );
  const all: LairRoom[] = [];
  for (const levelId of levels) {
    const rooms = (lair.levels.get(levelId)?.rooms ?? [])
      .filter((r) => r.kind === "project" && r.ready && mayEnter(r.id))
      .sort((a, b) => a.id.localeCompare(b.id));
    all.push(...rooms);
  }
  if (all.length <= ROUND_MAX_ROOMS) return all;
  const start = (((slot * ROUND_MAX_ROOMS) % all.length) + all.length) % all.length;
  return Array.from(
    { length: ROUND_MAX_ROOMS },
    (_, i) => all[(start + i) % all.length] as LairRoom,
  );
}

const layoutOf = (room: LairRoom): RoomLayout | null =>
  projectRoomLayout({
    width: room.tiles.w,
    depth: room.tiles.d,
    doorSide: room.doorSide,
    deskCount: room.deskCount,
    decorStyle: room.decorStyle,
  });

/**
 * Where to stand next to a seated henchman, room frame: behind its chair or to
 * either side, the first of those clear of furniture and of the other chairs.
 */
export function besideSeat(layout: RoomLayout, seat: Seat): Pose {
  const h = seat.pose.heading;
  // The way the henchman faces, and its right-hand side.
  const f = { x: -Math.sin(h), z: -Math.cos(h) };
  const r = { x: -f.z, z: f.x };
  const at = (dx: number, dz: number): Pose => {
    const x = seat.pose.x + dx;
    const z = seat.pose.z + dz;
    return { x, z, heading: Math.atan2(x - seat.pose.x, z - seat.pose.z) };
  };
  const options = [
    at(-f.x * BESIDE, -f.z * BESIDE),
    at((r.x - f.x * 0.6) * BESIDE, (r.z - f.z * 0.6) * BESIDE),
    at((-r.x - f.x * 0.6) * BESIDE, (-r.z - f.z * 0.6) * BESIDE),
  ];
  const clear = (p: Pose) =>
    p.x > 0.5 &&
    p.z > 0.5 &&
    p.x < layout.size.width - 0.5 &&
    p.z < layout.size.depth - 0.5 &&
    layout.obstacles.every(
      (o) =>
        p.x < o.rect.x - 0.3 ||
        p.x > o.rect.x + o.rect.w + 0.3 ||
        p.z < o.rect.z - 0.3 ||
        p.z > o.rect.z + o.rect.d + 0.3,
    ) &&
    layout.seats.every((s) => s.id === seat.id || Math.hypot(s.pose.x - p.x, s.pose.z - p.z) > 0.6);
  return options.find(clear) ?? (options[0] as Pose);
}

const line = (h: RoundHenchman): string => {
  const name = h.name || "a henchman";
  if (h.state === "finished") return `${name} has finished`;
  return h.ownerName ? `${name} is waiting for ${h.ownerName}` : `${name} is waiting`;
};

/**
 * The stops inside one room, as it is when the PM gets there: its issue and PR
 * boards, then the henchmen that wait (first) or have finished, by seat.
 */
export function roomStops(
  room: LairRoom,
  henchmen: readonly RoundHenchman[],
  pace = 1,
): RouteStop[] {
  const layout = layoutOf(room);
  const base = { levelId: room.levelId, operationId: room.id };
  if (!layout) {
    const c = centreOf(room.rect);
    return [
      { ...base, ...c, heading: 0, pauseMs: BOARD_PAUSE_MS * pace, doing: "looking over the crew" },
    ];
  }
  const place = (local: Pose) => {
    const p = clampInto(room.rect, { x: room.rect.x + local.x, z: room.rect.z + local.z }, 0.5);
    return { ...base, x: p.x, z: p.z, heading: local.heading };
  };
  const out: RouteStop[] = [];
  for (const kind of ["issue_board", "pr_board"] as const) {
    const anchor = layout.wallAnchors.find((a) => a.kind === kind);
    const wall = anchor ? wallById(layout, anchor.wallId) : undefined;
    if (!anchor || !wall) continue;
    out.push({
      ...place(anchorStandPose(wall, anchor)),
      pauseMs: BOARD_PAUSE_MS * pace,
      doing: kind === "issue_board" ? "checking the issue board" : "checking the PR board",
    });
  }
  const here = henchmen
    .filter((h) => h.operationId === room.id)
    .sort(
      (a, b) =>
        Number(b.state === "waiting") - Number(a.state === "waiting") ||
        a.seatId.localeCompare(b.seatId),
    )
    .slice(0, ROUND_MAX_VISITS);
  for (const h of here) {
    const seat = layout.seats.find((s) => s.id === h.seatId);
    if (!seat) continue;
    out.push({
      ...place(besideSeat(layout, seat)),
      pauseMs: (h.state === "waiting" ? WAITING_PAUSE_MS : FINISHED_PAUSE_MS) * pace,
      doing: line(h),
      visit: { henchmanId: h.agentId, ownerUserId: h.ownerUserId },
    });
  }
  return out;
}

/** One round: room after room, each room's stops decided when the PM turns to it. */
export function roundRoute(
  rooms: readonly LairRoom[],
  henchmen: () => RoundHenchman[],
  pace = 1,
): Route {
  let next = 0;
  let queue: RouteStop[] = [];
  return {
    // Stops in a room it lost meanwhile are passed over in one go.
    tries: 32,
    next() {
      while (queue.length === 0) {
        const room = rooms[next++];
        if (!room) return null;
        queue = roomStops(room, henchmen(), pace);
      }
      return queue.shift() ?? null;
    },
  };
}

export interface PmRoundsOptions {
  /** Henchmen that wait for their owner or have finished, anywhere in the office. */
  henchmen(): RoundHenchman[];
  /** Time between two rounds, ms. */
  everyMs?: number;
}

/** When the office PM's rounds start (`AgentWorldDeps.duty`). */
export class PmRounds {
  readonly everyMs: number;
  readonly #henchmen: () => RoundHenchman[];
  /** The last round each agent was asked about. */
  readonly #slots = new Map<string, number>();

  constructor(options: PmRoundsOptions) {
    this.everyMs = options.everyMs ?? PM_ROUND_EVERY_MS;
    this.#henchmen = options.henchmen;
  }

  /**
   * The round to set off on now, once per time slot: null when this slot's was
   * already handed out, when its start was missed (nobody was connected, or
   * the last round ran long), or when there is no room to visit.
   */
  duty(agent: WorldAgent, { lair, mayEnter, now }: DutyContext): Route | null {
    if (agent.post !== "reception") return null;
    const slot = roundSlot(now, this.everyMs);
    if (this.#slots.get(agent.id) === slot) return null;
    this.#slots.set(agent.id, slot);
    const late = now - slot * this.everyMs;
    if (late > Math.min(ROUND_START_WINDOW_MS, this.everyMs / 2)) return null;
    const rooms = roundRooms(lair, mayEnter, slot);
    return rooms.length > 0 ? roundRoute(rooms, this.#henchmen, stopPace(this.everyMs)) : null;
  }
}
