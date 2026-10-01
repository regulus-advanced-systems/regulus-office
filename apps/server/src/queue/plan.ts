/**
 * Which queued tasks of a room start now (#37). Pure, so the rules are
 * tested without a database or robots.
 *
 * Tasks are taken in queue order. A task starts when the room has a free
 * slot (`maxRunning`), its owner has one (`maxPerOwner`), a desk is free and
 * its owner may still spawn robots in the room. A task held back only by its
 * owner (their slot, or their access) does not hold up the tasks behind it;
 * a full room or no free desk holds up everything.
 */
import type { QueueSettings } from "@regulus/protocol";

export interface PlanTask {
  id: string;
  createdBy: string;
}

export interface PlanInput {
  /** Queued tasks in run order. */
  queued: readonly PlanTask[];
  /** Tasks running in the room now. */
  running: readonly PlanTask[];
  settings: QueueSettings;
  freeDesks: number;
  /** The owner may still spawn in this room (floor `spawn` / `manage`). */
  ownerMaySpawn: (userId: string) => boolean;
}

export interface QueuePlan {
  /** Task ids to start, in order. */
  start: string[];
  /** Why each queued task that does not start is waiting. */
  waiting: Map<string, string>;
}

export const WAIT_REASONS = {
  slot: "waiting for a free slot in this room",
  desk: "waiting for a free desk",
  owner: "waiting: its owner already runs as many tasks as allowed",
  access: "on hold: its owner may no longer spawn henchmen in this room",
} as const;

export function planQueue(input: PlanInput): QueuePlan {
  const { settings } = input;
  const perOwner = new Map<string, number>();
  for (const t of input.running) perOwner.set(t.createdBy, (perOwner.get(t.createdBy) ?? 0) + 1);
  let running = input.running.length;
  let desks = input.freeDesks;
  const start: string[] = [];
  const waiting = new Map<string, string>();
  const access = new Map<string, boolean>();
  const mayStart = (userId: string) => {
    let ok = access.get(userId);
    if (ok === undefined) {
      ok = input.ownerMaySpawn(userId);
      access.set(userId, ok);
    }
    return ok;
  };

  for (const task of input.queued) {
    if (!mayStart(task.createdBy)) {
      waiting.set(task.id, WAIT_REASONS.access);
      continue;
    }
    if (running >= settings.maxRunning) {
      waiting.set(task.id, WAIT_REASONS.slot);
      continue;
    }
    if ((perOwner.get(task.createdBy) ?? 0) >= settings.maxPerOwner) {
      waiting.set(task.id, WAIT_REASONS.owner);
      continue;
    }
    if (desks <= 0) {
      waiting.set(task.id, WAIT_REASONS.desk);
      continue;
    }
    start.push(task.id);
    running += 1;
    desks -= 1;
    perOwner.set(task.createdBy, (perOwner.get(task.createdBy) ?? 0) + 1);
  }
  return { start, waiting };
}
