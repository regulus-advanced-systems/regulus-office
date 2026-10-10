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
 * - `route` (route.ts): a scripted list of stops (`setRoute`). Stops in rooms
 *   it may not enter are skipped;
 * - `post` (#60): an agent with a home post (the office PM at reception)
 *   stands there instead of wandering, until its `duty` hands it a route (its
 *   round, rounds.ts); when the route is over it walks back. A board helper
 *   (#56, posts.ts) has its board as its post and no body at all while it
 *   cannot stand there: it never wanders, so its name is never seen outside
 *   its room.
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
  liftArrival,
  lobbyOf,
  readLair,
  roomAt,
} from "./geometry.ts";
import { type Body, type Brain, homeSpot, sendBody, stepRoute } from "./move.ts";
import { type Owner, readPeople, whereabouts } from "./people.ts";
import { boardPost, isBoardPost, postOf } from "./posts.ts";
import {
  loopRoute,
  type NextStop,
  nextStop,
  type Route,
  type RouteStop,
  type RouteVisit,
  walkMs,
} from "./route.ts";
import { levelSpots, roomSpots, type Spot } from "./spots.ts";
import type { AgentWorldDeps, WorldAgent } from "./types.ts";
import { pickWander, unitHash } from "./wander.ts";

export type { RouteStop } from "./route.ts";
export type { AgentWorldDeps, WorldAgent } from "./types.ts";

type State = InstanceType<typeof BuildingStateSchema>;

/** Bodies are stepped this often, and the agent list re-read this often, ms. */
export const STEP_MS = 300;
export const SYNC_MS = 2_000;
/**
 * The owner moved this far since the agent was last sent: send it again, metres. With the
 * polite distance this stays under `OFFICE_AGENT_REACH`: wherever its owner stops, `E`
 * reaches the agent at their side (at 1 m it could be left 2.4 m behind, out of reach, #299).
 */
export const FOLLOW_RETARGET = 0.7;
/** An answer of `mayEnter` is reused this long, ms. */
export const ACCESS_TTL_MS = 3_000;

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
  /** A body appeared, left, or changed room or level since the last tick's answer. */
  #placed = false;

  constructor(deps: AgentWorldDeps) {
    this.#deps = deps;
    this.#random = deps.random ?? Math.random;
  }

  /** The agent list changed (created, deleted, dismissed, recalled, a new look): re-read it at the next tick. */
  refresh(): void {
    this.#dirty = true;
    this.#access.clear();
  }

  /**
   * Put an agent on a scripted route: a list of stops walked round and round, or a
   * `Route` that ends. Null: back to following, its post or wandering.
   */
  setRoute(agentId: string, route: readonly RouteStop[] | Route | null): void {
    const brain = this.#brains.get(agentId);
    if (!brain) return;
    const stops = route && "next" in route ? route : route?.length ? loopRoute(route) : null;
    brain.route = stops;
    brain.arrival = null;
    brain.pending = null;
    brain.nextAt = 0;
  }

  /**
   * Called from the BuildingRoom's sweep. Costs one comparison while nobody is connected.
   * True when a body appeared, left, or changed room or level: who may see it has changed
   * (state is per viewer, #270), so the room brings its clients' views in line.
   */
  tick(state: State, now: number): boolean {
    if (state.humans.size === 0) return false;
    if (now - this.#steppedAt < STEP_MS) return false;
    this.#step(state, now);
    const placed = this.#placed;
    this.#placed = false;
    return placed;
  }

  #step(state: State, now: number): void {
    this.#steppedAt = now;
    const key = lairKey(state);
    if (!this.#lair || this.#lair.key !== key) this.#lair = readLair(state);
    const lair = this.#lair;
    if (!lobbyOf(lair.levels.get(LOBBY_LEVEL_ID))) return; // the layout is not published yet
    if (this.#dirty || now - this.#syncedAt >= SYNC_MS) this.#sync(state, lair, now);

    const { owners, populated } = readPeople(state);

    const slots = new Map<string, number>();
    for (const agent of this.#agents) {
      const body = state.officeAgents.get(agent.id);
      const brain = this.#brains.get(agent.id);
      if (!body || !brain) continue;
      const may = (operationId: string) => this.#mayEnter(agent.id, operationId, now);
      const owner = agent.ownerUserId ? owners.get(agent.ownerUserId) : undefined;
      if (brain.arrival && now >= brain.arrival.at) {
        const { visit } = brain.arrival;
        brain.arrival = null;
        this.#deps.standingBy?.(
          agent,
          visit,
          whereabouts(lair, body, owners.get(visit.ownerUserId)),
        );
      }
      if (!brain.route && body.mode === "post" && now >= brain.nextAt) {
        brain.route = this.#deps.duty?.(agent, { lair, mayEnter: may, now }) ?? null;
      }
      if (brain.route) {
        this.#route(body, brain, lair, may, now);
      } else if (this.#toPost(agent, body, brain, lair, may)) {
        // At its post, or on its way back there.
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
    // A board helper is only ever at its board, in a finished room it may be in.
    this.#agents = this.#deps
      .agents()
      .filter(
        (agent) =>
          !isBoardPost(agent.post) ||
          (boardPost(lair, agent) !== null && this.#mayEnter(agent.id, agent.postRoom ?? "", now)),
      );
    const ids = new Set(this.#agents.map((a) => a.id));
    for (const id of [...state.officeAgents.keys()]) {
      if (ids.has(id)) continue;
      state.officeAgents.delete(id);
      this.#brains.delete(id);
      this.#placed = true;
    }
    for (const agent of this.#agents) {
      let body = state.officeAgents.get(agent.id);
      if (!body || !this.#brains.has(agent.id)) {
        body = body ?? new OfficeAgentBodySchema();
        body.agentId = agent.id;
        const home = homeSpot(agent.id, lair);
        this.#brains.set(agent.id, {
          nextAt: now + 1_000 + this.#random() * 4_000,
          anchor: null,
          place: home.place,
          route: null,
          arrival: null,
          pending: null,
        });
        this.#send(body, "wander", home, { hop: true, doing: home.doing });
        // One with a post appears at it.
        this.#toPost(agent, body, this.#brains.get(agent.id) as Brain, lair, () => true, true);
        if (!state.officeAgents.has(agent.id)) state.officeAgents.set(agent.id, body);
        this.#placed = true;
      }
      const owner = agent.ownerUserId ?? "";
      if (body.name !== agent.name) body.name = agent.name;
      if (body.ownerUserId !== owner) body.ownerUserId = owner;
      if (body.ownerName !== agent.ownerName) body.ownerName = agent.ownerName.slice(0, 64);
      if (body.appearance !== agent.appearance) body.appearance = agent.appearance;
      if (body.status !== agent.status) body.status = agent.status;
      if (body.dismissed !== agent.dismissed) body.dismissed = agent.dismissed;
      if (body.post !== (agent.post ?? "none")) body.post = agent.post ?? "none";
    }
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

  /** Send a body somewhere (move.ts); true when it changed level and stepped out of the lift. */
  #send(
    body: Body,
    mode: OfficeAgentBodyMode,
    to: Pose & { levelId: string; operationId: string },
    options: { hop?: boolean; doing?: string } = {},
  ): boolean {
    const sent = sendBody(this.#lair, body, mode, to, options);
    if (sent.placed) this.#placed = true;
    return sent.byLift;
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
    const byLift = this.#send(
      body,
      plan.mode,
      { ...plan.target, levelId: level.levelId, operationId: plan.operationId },
      { doing: plan.doing },
    );
    // Just out of the lift: no anchor yet, so the next step walks it on to its owner.
    brain.anchor = byLift ? null : { levelId: owner.levelId, x: owner.x, z: owner.z };
    brain.place = byLift ? "" : (room?.id ?? "");
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
    if (this.#send(body, "wander", pick.spot, { doing: pick.spot.doing })) {
      // Out of the lift on another level: look round, then wander on from the landing.
      brain.place = "";
      brain.nextAt = now + 2_500;
      return;
    }
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
    const out = room ? doorWait(room) : homeSpot(body.agentId, lair);
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

  /** An agent with a post goes there and stays (#60). False for an agent without one. */
  #toPost(
    agent: WorldAgent,
    body: Body,
    brain: Brain,
    lair: Lair,
    mayEnter: (operationId: string) => boolean,
    hop = false,
  ): boolean {
    const post = postOf(lair, agent);
    // A board helper whose board is gone or shut to it stays put until the next sync takes its body.
    if (isBoardPost(agent.post) && (!post || !mayEnter(post.operationId))) return true;
    if (!post) return false;
    const t = body.target;
    if (body.mode === "post" && body.levelId === post.levelId && t.x === post.x && t.z === post.z)
      return true;
    this.#send(body, "post", post, { hop, doing: post.doing });
    brain.anchor = null;
    brain.place = post.place;
    // Not off again before it has had a moment at its desk.
    brain.nextAt = 0;
    return true;
  }

  #route(
    body: Body,
    brain: Brain,
    lair: Lair,
    mayEnter: (operationId: string) => boolean,
    now: number,
  ): void {
    stepRoute(body, brain, lair, mayEnter, now, (to, doing) =>
      this.#send(body, "route", to, { doing }),
    );
  }
}
