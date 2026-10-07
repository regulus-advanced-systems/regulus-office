/**
 * Office agents' bodies in the world (SPEC §9.3, D12, D28, D32; #252).
 *
 * `AgentWorld` owns `BuildingState.officeAgents`: one body per office agent,
 * each with a *target* to walk to. It runs inside the BuildingRoom's sweep
 * (`tick`) and does nothing while nobody is connected. What a body does:
 *
 * - `follow` / `wait` (follow.ts): a personal agent whose owner is here and
 *   has not dismissed it stays beside them, changes level with them, and
 *   waits at the door of a room it may not enter;
 * - `wander` (wander.ts, spots.ts): everyone else strolls between spots of
 *   the levels people are on, in the fixed rooms, the corridors and the
 *   project rooms it may enter;
 * - `route`: a scripted list of stops (`setRoute`), for the office PM's
 *   patrol and visits (#60). Stops in rooms it may not enter are skipped.
 *
 * A body never gives access: every project room is checked with `mayEnter`
 * (the office's operation access gate, through `AgentAccess`), again every
 * few seconds while it is inside, and it is walked out when the answer changes.
 */
import {
  type BuildingStateSchema,
  LOBBY_LEVEL_ID,
  LOBBY_OPERATION_ID,
  OFFICE_AGENT_DOING_MAX,
  type OfficeAgentBodyMode,
  OfficeAgentBodySchema,
  type OfficeAgentStatus,
} from "@regulus/protocol";
import type { Pose } from "@regulus/room-layout";
import { planFollow } from "./follow.ts";
import {
  doorWait,
  type Lair,
  type LairLevel,
  lairKey,
  lobbyOf,
  readLair,
  roomAt,
} from "./geometry.ts";
import { levelSpots, roomSpots, type Spot } from "./spots.ts";
import { pickWander, unitHash } from "./wander.ts";

type State = InstanceType<typeof BuildingStateSchema>;
type Body = InstanceType<typeof OfficeAgentBodySchema>;

/** An office agent as the world needs it. */
export interface WorldAgent {
  id: string;
  name: string;
  /** Null: a shared agent. */
  ownerUserId: string | null;
  ownerName: string;
  appearance: string;
  status: OfficeAgentStatus;
  dismissed: boolean;
}

export interface AgentWorldDeps {
  /** Every office agent, oldest first. */
  agents(): WorldAgent[];
  /** May this agent be in this project room right now? Asked often; keep it a lookup. */
  mayEnter(agentId: string, operationId: string): boolean;
  random?: () => number;
}

/** One stop of a scripted route (#60). */
export interface RouteStop extends Pose {
  levelId: string;
  /** A project room's operation id when the stop is inside one. */
  operationId?: string;
  doing?: string;
  /** How long to stay, ms. */
  pauseMs: number;
}

/** Bodies are stepped this often, and the agent list re-read this often, ms. */
export const STEP_MS = 300;
export const SYNC_MS = 2_000;
/** The owner moved this far since the agent was last sent: send it again, metres. */
export const FOLLOW_RETARGET = 1;
/** An answer of `mayEnter` is reused this long, ms. */
export const ACCESS_TTL_MS = 3_000;

interface Brain {
  /** Wander and route: when to pick the next spot. */
  nextAt: number;
  /** Follow: where the owner was (and on which level) when the agent was last sent. */
  anchor: { levelId: string; x: number; z: number } | null;
  /** The room or corridor of its spot (spots.ts `place`). */
  place: string;
  route: { stops: readonly RouteStop[]; index: number } | null;
}

interface Owner extends Pose {
  levelId: string;
  joinedAt: number;
}

export class AgentWorld {
  readonly #deps: AgentWorldDeps;
  readonly #random: () => number;
  readonly #brains = new Map<string, Brain>();
  readonly #access = new Map<string, { ok: boolean; at: number }>();
  #agents: WorldAgent[] = [];
  #dirty = true;
  #syncedAt = Number.NEGATIVE_INFINITY;
  #steppedAt = Number.NEGATIVE_INFINITY;
  #lair: Lair | null = null;

  constructor(deps: AgentWorldDeps) {
    this.#deps = deps;
    this.#random = deps.random ?? Math.random;
  }

  /** The agent list changed (created, deleted, dismissed, recalled, a new look): re-read it at the next tick. */
  refresh(): void {
    this.#dirty = true;
    this.#access.clear();
  }

  /** Put an agent on a scripted route, or (null) back to following or wandering. */
  setRoute(agentId: string, stops: readonly RouteStop[] | null): void {
    const brain = this.#brains.get(agentId);
    if (!brain) return;
    brain.route = stops && stops.length > 0 ? { stops, index: -1 } : null;
    brain.nextAt = 0;
  }

  /** Called from the BuildingRoom's sweep. Costs one comparison while nobody is connected. */
  tick(state: State, now: number): void {
    if (state.humans.size === 0) return;
    if (now - this.#steppedAt < STEP_MS) return;
    this.#steppedAt = now;
    const key = lairKey(state);
    if (!this.#lair || this.#lair.key !== key) this.#lair = readLair(state);
    const lair = this.#lair;
    if (!lobbyOf(lair.levels.get(LOBBY_LEVEL_ID))) return; // the layout is not published yet
    if (this.#dirty || now - this.#syncedAt >= SYNC_MS) this.#sync(state, lair, now);

    const owners = new Map<string, Owner>();
    const populated = new Set<string>();
    state.humans.forEach((h) => {
      populated.add(h.levelId);
      const seen = owners.get(h.userId);
      // Someone connected twice is where they joined last.
      if (seen && seen.joinedAt > h.joinedAt) return;
      owners.set(h.userId, {
        x: h.position.x,
        z: h.position.z,
        heading: h.position.heading,
        levelId: h.levelId,
        joinedAt: h.joinedAt,
      });
    });

    const slots = new Map<string, number>();
    for (const agent of this.#agents) {
      const body = state.officeAgents.get(agent.id);
      const brain = this.#brains.get(agent.id);
      if (!body || !brain) continue;
      const may = (operationId: string) => this.#mayEnter(agent.id, operationId, now);
      const owner = agent.ownerUserId ? owners.get(agent.ownerUserId) : undefined;
      if (brain.route) {
        this.#route(body, brain, lair, may, now);
      } else if (owner && agent.ownerUserId && !agent.dismissed && lair.levels.has(owner.levelId)) {
        const slot = slots.get(agent.ownerUserId) ?? 0;
        slots.set(agent.ownerUserId, slot + 1);
        this.#follow(body, brain, lair.levels.get(owner.levelId) as LairLevel, owner, slot, may);
      } else {
        this.#wander(body, brain, lair, populated, may, now);
      }
    }
  }

  // ---- The agent list ----------------------------------------------------------------

  #sync(state: State, lair: Lair, now: number): void {
    this.#dirty = false;
    this.#syncedAt = now;
    this.#agents = this.#deps.agents();
    const ids = new Set(this.#agents.map((a) => a.id));
    for (const id of [...state.officeAgents.keys()]) {
      if (ids.has(id)) continue;
      state.officeAgents.delete(id);
      this.#brains.delete(id);
    }
    for (const agent of this.#agents) {
      let body = state.officeAgents.get(agent.id);
      if (!body || !this.#brains.has(agent.id)) {
        body = body ?? new OfficeAgentBodySchema();
        body.agentId = agent.id;
        const home = this.#home(agent.id, lair);
        this.#brains.set(agent.id, {
          nextAt: now + 1_000 + this.#random() * 4_000,
          anchor: null,
          place: home.place,
          route: null,
        });
        this.#send(body, "wander", home, { hop: true, doing: home.doing });
        if (!state.officeAgents.has(agent.id)) state.officeAgents.set(agent.id, body);
      }
      const owner = agent.ownerUserId ?? "";
      if (body.name !== agent.name) body.name = agent.name;
      if (body.ownerUserId !== owner) body.ownerUserId = owner;
      if (body.ownerName !== agent.ownerName) body.ownerName = agent.ownerName.slice(0, 64);
      if (body.appearance !== agent.appearance) body.appearance = agent.appearance;
      if (body.status !== agent.status) body.status = agent.status;
      if (body.dismissed !== agent.dismissed) body.dismissed = agent.dismissed;
    }
  }

  /** Where an agent first appears: its own spot in the lobby, the same after every restart. */
  #home(agentId: string, lair: Lair): Spot {
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

  #mayEnter(agentId: string, operationId: string, now: number): boolean {
    const key = `${agentId}\n${operationId}`;
    const known = this.#access.get(key);
    if (known && now - known.at < ACCESS_TTL_MS) return known.ok;
    const ok = this.#deps.mayEnter(agentId, operationId);
    this.#access.set(key, { ok, at: now });
    return ok;
  }

  // ---- Moving a body -------------------------------------------------------------------

  /**
   * The one place a body is sent somewhere. `hop` places it there at once
   * instead of walking: its first appearance and every change of level.
   */
  #send(
    body: Body,
    mode: OfficeAgentBodyMode,
    to: Pose & { levelId: string; operationId: string },
    options: { hop?: boolean; doing?: string } = {},
  ): void {
    if (body.levelId !== to.levelId) this.#travelToLevel(body, to.levelId);
    else if (options.hop) body.hop += 1;
    if (body.mode !== mode) body.mode = mode;
    if (body.operationId !== to.operationId) body.operationId = to.operationId;
    const doing = (options.doing ?? "").slice(0, OFFICE_AGENT_DOING_MAX);
    if (body.doing !== doing) body.doing = doing;
    const t = body.target;
    if (t.x !== to.x) t.x = to.x;
    if (t.z !== to.z) t.z = to.z;
    if (t.heading !== to.heading) t.heading = to.heading;
  }

  /**
   * A body changes level. Today it is placed on the new level at once; when the
   * lift exists (#269) this is where it walks to the lift and rides it.
   */
  #travelToLevel(body: Body, levelId: string): void {
    body.levelId = levelId;
    body.hop += 1;
  }

  #follow(
    body: Body,
    brain: Brain,
    level: LairLevel,
    owner: Owner,
    slot: number,
    mayEnter: (operationId: string) => boolean,
  ): void {
    const sameLevel = brain.anchor?.levelId === owner.levelId && body.levelId === owner.levelId;
    const following = body.mode === "follow" || body.mode === "wait";
    const moved = brain.anchor ? Math.hypot(owner.x - brain.anchor.x, owner.z - brain.anchor.z) : 0;
    const room = roomAt(level, owner);
    const shut = room?.kind === "project" && (!room.ready || !mayEnter(room.id));
    // Still beside them, and nothing changed about where it may be: leave it.
    if (following && sameLevel && moved < FOLLOW_RETARGET && shut === (body.mode === "wait"))
      return;
    const plan = planFollow({
      level,
      owner,
      from: sameLevel && brain.anchor ? brain.anchor : null,
      slot,
      mayEnter,
    });
    this.#send(
      body,
      plan.mode,
      { ...plan.target, levelId: level.levelId, operationId: plan.operationId },
      { doing: plan.doing },
    );
    brain.anchor = { levelId: owner.levelId, x: owner.x, z: owner.z };
    brain.place = room?.id ?? "";
    brain.nextAt = 0;
  }

  #wander(
    body: Body,
    brain: Brain,
    lair: Lair,
    populated: ReadonlySet<string>,
    mayEnter: (operationId: string) => boolean,
    now: number,
  ): void {
    // It was following until now (dismissed, or its owner left): set off shortly.
    if (body.mode !== "wander") {
      body.mode = "wander";
      brain.anchor = null;
      brain.nextAt = now + 1_500;
    }
    if (this.#evict(body, brain, lair, mayEnter, now)) return;
    if (now < brain.nextAt) return;
    // Only where somebody can see it: a level nobody is on costs nothing.
    const spots: Spot[] = [];
    for (const levelId of populated) {
      const level = lair.levels.get(levelId);
      if (level) spots.push(...levelSpots(level, mayEnter));
    }
    const pick = pickWander(
      spots,
      { levelId: body.levelId, place: brain.place, x: body.target.x, z: body.target.z },
      this.#random,
    );
    if (!pick) {
      brain.nextAt = now + 5_000;
      return;
    }
    this.#send(body, "wander", pick.spot, { doing: pick.spot.doing });
    brain.place = pick.spot.place;
    brain.nextAt = now + pick.after;
  }

  /** A body in a project room it may no longer be in (or that is gone) walks out. True when it did. */
  #evict(
    body: Body,
    brain: Brain,
    lair: Lair,
    mayEnter: (operationId: string) => boolean,
    now: number,
  ): boolean {
    if (body.operationId === LOBBY_OPERATION_ID) return false;
    const level = lair.levels.get(body.levelId);
    const room = level?.rooms.find((r) => r.id === body.operationId);
    if (room?.ready && mayEnter(room.id)) return false;
    const out = room ? doorWait(room) : this.#home(body.agentId, lair);
    this.#send(
      body,
      "wander",
      {
        x: out.x,
        z: out.z,
        heading: out.heading,
        levelId: room ? body.levelId : LOBBY_LEVEL_ID,
        operationId: LOBBY_OPERATION_ID,
      },
      { hop: !room },
    );
    brain.place = "";
    brain.nextAt = now + 4_000;
    return true;
  }

  #route(
    body: Body,
    brain: Brain,
    lair: Lair,
    mayEnter: (operationId: string) => boolean,
    now: number,
  ): void {
    const route = brain.route;
    if (!route || now < brain.nextAt) return;
    // The next stop it may stand at; a route with none leaves it where it is.
    for (let tried = 0; tried < route.stops.length; tried++) {
      route.index = (route.index + 1) % route.stops.length;
      const stop = route.stops[route.index] as RouteStop;
      const level = lair.levels.get(stop.levelId);
      if (!level) continue;
      const room = roomAt(level, stop);
      if (room?.kind === "project" && (!room.ready || !mayEnter(room.id))) continue;
      const operationId = room?.kind === "project" ? room.id : LOBBY_OPERATION_ID;
      const far = Math.hypot(stop.x - body.target.x, stop.z - body.target.z);
      this.#send(body, "route", { ...stop, operationId }, { doing: stop.doing });
      brain.place = room?.id ?? "";
      brain.nextAt = now + (far / 3) * 1_600 + stop.pauseMs;
      return;
    }
    brain.nextAt = now + 5_000;
  }
}
