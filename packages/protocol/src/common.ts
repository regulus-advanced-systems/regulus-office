/** Small zod building blocks reused across state shapes, commands and events. */
import { z } from "zod";

/** Opaque identifier (DB id, Colyseus session id, seat id from the layout, ...). */
export const Id = z.string().min(1).max(128);
export type Id = z.infer<typeof Id>;

/** Unix epoch milliseconds, server clock. */
export const TimestampMs = z.number().int().nonnegative();
export type TimestampMs = z.infer<typeof TimestampMs>;

/** Non-negative integer counter. */
export const Count = z.number().int().nonnegative();
export type Count = z.infer<typeof Count>;

/** GitHub issue / pull request number. */
export const GhNumber = z.number().int().positive();
export type GhNumber = z.infer<typeof GhNumber>;

/**
 * Position on a floor's ground plane in world units. `x`/`z` follow the
 * three.js convention (y is up); `heading` is yaw in radians.
 */
export const WorldPos = z.object({
  x: z.number().finite(),
  z: z.number().finite(),
  heading: z.number().finite(),
});
export type WorldPos = z.infer<typeof WorldPos>;

/** Free text shown in the world (chat lines, prompts, task titles). */
export const ShortText = z.string().max(200);
export const ChatText = z.string().trim().min(1).max(2000);
export const PROMPT_MAX = 20_000;
export const PromptText = z.string().trim().min(1).max(PROMPT_MAX);

/** Model name as passed to the provider CLI; effort is provider-specific (e.g. `low|medium|high|max`). */
export const ModelName = z.string().min(1).max(100);
export const Effort = z.string().min(1).max(32);
