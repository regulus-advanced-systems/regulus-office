/**
 * The merge gong (#43, SPEC D9), server side. Everything it does is a
 * broadcast to one operation's OperationRoom; clients ring the gong, burst confetti
 * and let their henchmen celebrate (apps/web/src/scene/gong).
 *
 * - `followGitHub(bus)`: a merged PR of an operation's repo (#35 webhook or poll)
 *   broadcasts `pr.merged` to that operation, once per merge (merges.ts).
 * - `boardMerged(...)`: the same for a merge made from the office's PR board
 *   (#36), without waiting for the webhook or the next poll; the mark makes
 *   their later report of it a no-op.
 * - `bang(operationId, user)`: a human bangs the gong (`gong.bang`), rate-limited
 *   per operation and per human (bang-limit.ts), broadcast as `gong.ring`.
 * - `queueEmptied(operationId)`: the task queue (#37) emptied (queue-watch.ts
 *   detects it from the queue's publishes): a triple ring. Repeats within
 *   `QUEUE_EMPTY_REPEAT_MS` are dropped, so a queue that flaps between one
 *   and zero tasks does not ring each time.
 *
 * Nothing is queued for operations nobody is on: a ring is a moment, not state.
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
  /** The OperationRoom registry's broadcast (OperationRooms.broadcast). */
  operations: { broadcast(operationId: string, type: string, payload: unknown): boolean };
  logger: Logger;
  /** `https://github.com` (OFFICE_GITHUB_WEB_BASE), for the PR link. */
  githubWebBase?: string;
  limits?: Partial<BangLimits>;
  now?: () => number;
}

export interface Celebrations {
  /** Ring for merged PRs on the GitHub event bus. Replaces an earlier subscription. */
  followGitHub(events: Pick<GitHubEventBus, "on">): void;
  /** A PR was merged from the office's PR board. Returns the operations that rang. */
  boardMerged(pull: MergedPull): string[];
  /** A human banged the gong on an operation they are on. */
  bang(operationId: string, user: { userId: string; displayName: string }): BangVerdict;
  /**
   * The task queue (#37) of `operationId` just emptied: a triple ring. Safe to
   * call on every transition to empty; returns whether it rang.
   */
  queueEmptied(operationId: string): boolean;
  close(): void;
}

export function createCelebrations(deps: CelebrationsDeps): Celebrations {
  const logger = deps.logger.child({ component: "celebrations" });
  const now = deps.now ?? Date.now;
  const webBase = (deps.githubWebBase ?? "https://github.com").replace(/\/+$/, "");
  const limiter = new BangLimiter(deps.limits, now);
  const queueRungAt = new Map<string, number>();
  let unsubscribe: (() => void) | undefined;

  const ring = (operationId: string, cause: GongCause, by?: string): boolean => {
    const payload = GongRing.parse({
      operationId,
      cause,
      strikes: GONG_STRIKES[cause],
      ...(by ? { by: by.slice(0, 64) } : {}),
      at: now(),
    });
    limiter.rang(operationId);
    return deps.operations.broadcast(operationId, GONG_RING_MESSAGE, payload);
  };

  const merged = (pull: MergedPull, source: string): string[] => {
    const operations: string[] = [];
    for (const r of claimMergeRings(deps.db, pull, webBase)) {
      const payload = PrMerged.parse({ ...r, at: now() });
      limiter.rang(r.operationId);
      deps.operations.broadcast(r.operationId, PR_MERGED_MESSAGE, payload);
      operations.push(r.operationId);
      logger.info({ operationId: r.operationId, prNumber: r.number, source }, "merge gong rang");
    }
    return operations;
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

    bang(operationId, user) {
      const verdict = limiter.bang(operationId, user.userId);
      if (verdict.ok) ring(operationId, "bang", user.displayName);
      return verdict;
    },

    queueEmptied(operationId) {
      const t = now();
      const last = queueRungAt.get(operationId);
      if (last !== undefined && t - last < QUEUE_EMPTY_REPEAT_MS) return false;
      queueRungAt.set(operationId, t);
      for (const [id, at] of queueRungAt)
        if (t - at >= QUEUE_EMPTY_REPEAT_MS) queueRungAt.delete(id);
      ring(operationId, "queue_empty");
      return true;
    },

    close() {
      unsubscribe?.();
      unsubscribe = undefined;
    },
  };
}
