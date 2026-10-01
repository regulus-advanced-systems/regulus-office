/**
 * Merge gong (#43, SPEC D9): OperationRoom server→client messages.
 *
 * - `pr.merged` is broadcast to every operation whose repo the merged PR belongs
 *   to, once per merge (webhook, poll or a merge from the office's PR board).
 *   Clients ring the gong once, burst confetti and let the henchmen celebrate.
 * - `gong.ring` is every other ring: a human banged the gong (`gong.bang`,
 *   rate-limited on the server) or the operation's task queue emptied (a triple
 *   ring). Clients treat it like a merge without the PR toast.
 */
import { z } from "zod";
import { GhNumber, Id, TimestampMs } from "./common.ts";

export const PR_MERGED_MESSAGE = "pr.merged";
export const GONG_RING_MESSAGE = "gong.ring";

/** Why the gong rings. */
export const GONG_CAUSES = ["merge", "bang", "queue_empty"] as const;
export type GongCause = (typeof GONG_CAUSES)[number];

/** How many strikes per cause: one for a merge or a bang, three when the queue empties. */
export const GONG_STRIKES: Readonly<Record<GongCause, number>> = {
  merge: 1,
  bang: 1,
  queue_empty: 3,
};

export const PrMerged = z.object({
  operationId: Id,
  repoId: Id,
  number: GhNumber,
  /** PR title, as GitHub reported it (may be empty from a sparse payload). */
  title: z.string().max(300),
  /** `https://github.com/<owner>/<repo>/pull/<n>`, or "" when unknown. */
  url: z.string().max(500),
  at: TimestampMs,
});
export type PrMerged = z.infer<typeof PrMerged>;

export const GongRing = z.object({
  operationId: Id,
  cause: z.enum(GONG_CAUSES),
  strikes: z.number().int().min(1).max(3),
  /** Display name of the human who banged it (bang only). */
  by: z.string().max(64).optional(),
  at: TimestampMs,
});
export type GongRing = z.infer<typeof GongRing>;
