/**
 * The merge gong (#43, SPEC D9), server side. Everything it does is a
 * broadcast to one floor's FloorRoom; clients ring the gong, burst confetti
 * and let their robots celebrate (apps/web/src/scene/gong).
 *
 * - `followGitHub(bus)`: a merged PR of a floor's repo (#35 webhook or poll)
 *   broadcasts `pr.merged` to that floor, once per merge (merges.ts).
 * - `boardMerged(...)`: the same for a merge made from the office's PR board
 *   (#36), without waiting for the webhook or the next poll; the mark makes
 *   their later report of it a no-op.
 * - `bang(floorId, user)`: a human bangs the gong (`gong.bang`), rate-limited
 *   per floor and per human (bang-limit.ts), broadcast as `gong.ring`.
 * - `queueEmptied(floorId)`: the hook for the task queue (#37). Its last task
 *   done and the queue empty: a triple ring. Repeats within
 *   `QUEUE_EMPTY_REPEAT_MS` are dropped, so a queue that flaps between one
 *   and zero tasks does not ring each time.
 *
 * Nothing is queued for floors nobody is on: a ring is a moment, not state.
 */
import {
  GONG_RING_MESSAGE,
  GONG_STRIKES,
  type GongCause,
  GongRing,
  PR_MERGED_MESSAGE,
  PrMerged,
} from "@regulus/protocol";
import type { Db } from "../db/index.ts";
import type { GitHubEventBus } from "../github/events.ts";
import type { Logger } from "../logging.ts";
import { BangLimiter, type BangLimits, type BangVerdict } from "./bang-limit.ts";
import { claimMergeRings, type MergedPull, mergedPullOf } from "./merges.ts";

export const QUEUE_EMPTY_REPEAT_MS = 10_000;

export interface CelebrationsDeps {
  db: Db;
  /** The FloorRoom registry's broadcast (FloorRooms.broadcast). */
  floors: { broadcast(floorId: string, type: string, payload: unknown): boolean };
  logger: Logger;
  /** `https://github.com` (OFFICE_GITHUB_WEB_BASE), for the PR link. */
  githubWebBase?: string;
  limits?: Partial<BangLimits>;
  now?: () => number;
}

export interface Celebrations {
  /** Ring for merged PRs on the GitHub event bus. Replaces an earlier subscription. */
  followGitHub(events: Pick<GitHubEventBus, "on">): void;
  /** A PR was merged from the office's PR board. Returns the floors that rang. */
  boardMerged(pull: MergedPull): string[];
  /** A human banged the gong on a floor they are on. */
  bang(floorId: string, user: { userId: string; displayName: string }): BangVerdict;
  /**
   * The task queue (#37) of `floorId` just emptied: a triple ring. Safe to
   * call on every transition to empty; returns whether it rang.
   */
  queueEmptied(floorId: string): boolean;
  close(): void;
}

export function createCelebrations(deps: CelebrationsDeps): Celebrations {
  const logger = deps.logger.child({ component: "celebrations" });
  const now = deps.now ?? Date.now;
  const webBase = (deps.githubWebBase ?? "https://github.com").replace(/\/+$/, "");
  const limiter = new BangLimiter(deps.limits, now);
  const queueRungAt = new Map<string, number>();
  let unsubscribe: (() => void) | undefined;

  const ring = (floorId: string, cause: GongCause, by?: string): boolean => {
    const payload = GongRing.parse({
      floorId,
      cause,
      strikes: GONG_STRIKES[cause],
      ...(by ? { by: by.slice(0, 64) } : {}),
      at: now(),
    });
    limiter.rang(floorId);
    return deps.floors.broadcast(floorId, GONG_RING_MESSAGE, payload);
  };

  const merged = (pull: MergedPull, source: string): string[] => {
    const floors: string[] = [];
    for (const r of claimMergeRings(deps.db, pull, webBase)) {
      const payload = PrMerged.parse({ ...r, at: now() });
      limiter.rang(r.floorId);
      deps.floors.broadcast(r.floorId, PR_MERGED_MESSAGE, payload);
      floors.push(r.floorId);
      logger.info({ floorId: r.floorId, prNumber: r.number, source }, "merge gong rang");
    }
    return floors;
  };

  return {
    followGitHub(events) {
      unsubscribe?.();
      unsubscribe = events.on("pull_request", (event) => {
        const pull = mergedPullOf(event);
        if (pull) merged(pull, event.source);
      });
    },

    boardMerged: (pull) => merged(pull, "board"),

    bang(floorId, user) {
      const verdict = limiter.bang(floorId, user.userId);
      if (verdict.ok) ring(floorId, "bang", user.displayName);
      return verdict;
    },

    queueEmptied(floorId) {
      const t = now();
      const last = queueRungAt.get(floorId);
      if (last !== undefined && t - last < QUEUE_EMPTY_REPEAT_MS) return false;
      queueRungAt.set(floorId, t);
      for (const [id, at] of queueRungAt)
        if (t - at >= QUEUE_EMPTY_REPEAT_MS) queueRungAt.delete(id);
      ring(floorId, "queue_empty");
      return true;
    },

    close() {
      unsubscribe?.();
      unsubscribe = undefined;
    },
  };
}
