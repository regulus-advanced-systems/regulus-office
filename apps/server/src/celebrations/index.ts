/** Merge gong (#43): `pr.merged` / `gong.ring` broadcasts to a floor's FloorRoom. */
export { BangLimiter, type BangLimits, DEFAULT_BANG_LIMITS } from "./bang-limit.ts";
export { gongMark, type MergedPull, mergedPullOf } from "./merges.ts";
export { watchQueueEmptied } from "./queue-watch.ts";
export {
  type Celebrations,
  type CelebrationsDeps,
  createCelebrations,
  QUEUE_EMPTY_REPEAT_MS,
} from "./service.ts";
