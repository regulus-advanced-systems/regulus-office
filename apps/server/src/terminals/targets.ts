/**
 * Which tmux session a terminal connection attaches to, and through which
 * runner. The AgentManager (#26) owns agents at runtime; until it exists this
 * resolves from the `agents` table plus a registry of runner backends, and #26
 * can register runners here or replace {@link TerminalTargets} wholesale.
 */
import { tmuxSessionName } from "@regulus/agent-adapters";
import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { agents } from "../db/schema/index.ts";
import type { Runner, TmuxSessionRef } from "../runners/types.ts";

/** Agent ids usable in a path and a tmux session name (see `tmuxSessionName`). */
export const AGENT_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** Everything the bridge needs to authorise and attach one agent's terminal. */
export interface TerminalTarget {
  agentId: string;
  /** The human whose runner the agent runs in (SPEC §8 rule 4). */
  ownerUserId: string;
  floorId: string;
  session: TmuxSessionRef;
  runner: Runner;
}

export interface TerminalTargets {
  /** The agent's terminal target, or null when it is unknown or has no runner. */
  resolve(agentId: string): Promise<TerminalTarget | null>;
}

/** The robots on one floor whose screens can be captured (laptop screen feed). */
export interface FloorTerminalTargets {
  /** Live agents on `floorId` that have a runner; exited ones are left out. */
  listFloor(floorId: string): Promise<TerminalTarget[]>;
}

/** Which runner backend hosts a given human's runner. */
export interface RunnerLookup {
  runnerFor(userId: string): Runner | undefined;
}

/**
 * Runners by human, with an office-wide default (SPEC §8: one backend per
 * office). Empty until a backend is configured, so every lookup misses.
 */
export class RunnerRegistry implements RunnerLookup {
  #default: Runner | undefined;
  readonly #byUser = new Map<string, Runner>();

  setDefault(runner: Runner | undefined): this {
    this.#default = runner;
    return this;
  }

  set(userId: string, runner: Runner): this {
    this.#byUser.set(userId, runner);
    return this;
  }

  runnerFor(userId: string): Runner | undefined {
    return this.#byUser.get(userId) ?? this.#default;
  }
}

/** {@link TerminalTargets} over the `agents` table. */
export class DbTerminalTargets implements TerminalTargets, FloorTerminalTargets {
  constructor(
    private readonly db: Db,
    private readonly runners: RunnerLookup,
  ) {}

  async resolve(agentId: string): Promise<TerminalTarget | null> {
    if (!AGENT_ID_PATTERN.test(agentId)) return null;
    const row = this.db
      .select({
        ownerUserId: agents.ownerUserId,
        floorId: agents.floorId,
        tmuxSession: agents.tmuxSession,
        exitedAt: agents.exitedAt,
      })
      .from(agents)
      .where(eq(agents.id, agentId))
      .get();
    if (!row || row.exitedAt) return null;
    const runner = this.runners.runnerFor(row.ownerUserId);
    if (!runner) return null;
    return {
      agentId,
      ownerUserId: row.ownerUserId,
      floorId: row.floorId,
      session: { userId: row.ownerUserId, name: row.tmuxSession ?? tmuxSessionName(agentId) },
      runner,
    };
  }

  async listFloor(floorId: string): Promise<TerminalTarget[]> {
    const rows = this.db
      .select({ id: agents.id, ownerUserId: agents.ownerUserId, tmuxSession: agents.tmuxSession })
      .from(agents)
      .where(and(eq(agents.floorId, floorId), isNull(agents.exitedAt)))
      .all();
    const targets: TerminalTarget[] = [];
    for (const row of rows) {
      const runner = this.runners.runnerFor(row.ownerUserId);
      if (!runner || !AGENT_ID_PATTERN.test(row.id)) continue;
      targets.push({
        agentId: row.id,
        ownerUserId: row.ownerUserId,
        floorId,
        session: { userId: row.ownerUserId, name: row.tmuxSession ?? tmuxSessionName(row.id) },
        runner,
      });
    }
    return targets;
  }
}
