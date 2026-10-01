/**
 * The room build state machine (SPEC §9.1): a new room is `building` for the
 * build phase (OFFICE_ROOM_BUILD_SECONDS) while its repos clone, then
 * `ready`. Only time ends it: a clone that fails still ends the build, and
 * the room shows the floor's usual clone error. Timers are rebuilt from the
 * rows at boot, so a restart mid-build finishes on time (or at once).
 */
import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { floors } from "../db/schema/index.ts";
import type { Logger } from "../logging.ts";

export interface BuildTimersDeps {
  db: Db;
  logger: Logger;
  buildMs: number;
  now: () => number;
  /** A room finished building. */
  onReady(floorId: string): void;
}

export class BuildTimers {
  readonly #deps: BuildTimersDeps;
  readonly #timers = new Map<
    string,
    { startedAt: number | null; timer: ReturnType<typeof setTimeout> }
  >();
  #closed = false;

  constructor(deps: BuildTimersDeps) {
    this.#deps = deps;
  }

  /** When a build that started at `startedAt` ends. */
  endsAt(startedAt: number): number {
    return startedAt + this.#deps.buildMs;
  }

  /** Make sure every building room in `rooms` has a timer (idempotent). */
  sync(
    rooms: ReadonlyArray<{ id: string; buildState: string; buildStartedAt: Date | null }>,
  ): void {
    if (this.#closed) return;
    const building = new Set<string>();
    for (const room of rooms) {
      if (room.buildState !== "building") continue;
      building.add(room.id);
      const startedAt = room.buildStartedAt?.getTime() ?? null;
      const existing = this.#timers.get(room.id);
      if (existing?.startedAt === startedAt) continue;
      if (existing) clearTimeout(existing.timer);
      const delay = Math.max(0, this.endsAt(startedAt ?? 0) - this.#deps.now());
      const timer = setTimeout(() => this.#finish(room.id, startedAt), delay);
      this.#timers.set(room.id, { startedAt, timer });
    }
    for (const [id, entry] of this.#timers) {
      if (building.has(id)) continue;
      clearTimeout(entry.timer);
      this.#timers.delete(id);
    }
  }

  #finish(floorId: string, startedAt: number | null): void {
    this.#timers.delete(floorId);
    if (this.#closed) return;
    try {
      const done = this.#deps.db
        .update(floors)
        .set({ buildState: "ready" })
        .where(
          and(
            eq(floors.id, floorId),
            eq(floors.buildState, "building"),
            startedAt === null
              ? isNull(floors.buildStartedAt)
              : eq(floors.buildStartedAt, new Date(startedAt)),
          ),
        )
        .returning({ id: floors.id })
        .all();
      if (done.length === 0) return;
      this.#deps.logger.info({ floorId }, "room built");
      this.#deps.onReady(floorId);
    } catch (err) {
      this.#deps.logger.error({ err, floorId }, "finishing a room build failed");
    }
  }

  /** Number of builds in progress (tests). */
  get pending(): number {
    return this.#timers.size;
  }

  close(): void {
    this.#closed = true;
    for (const { timer } of this.#timers.values()) clearTimeout(timer);
    this.#timers.clear();
  }
}
