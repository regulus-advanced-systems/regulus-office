/**
 * Compound settings from the environment (SPEC §9.1):
 *
 * - OFFICE_ROOM_BUILD_SECONDS: length of a new room's build phase (0..600, default 20).
 * - OFFICE_BLAST_DOOR_SECONDS: how long the lobby's blast door stays open after a press
 *   (4..600, default 60; #188).
 * - OFFICE_COMPOUND_SIZE: tiles a side of a new compound (48..256, default 64). Only
 *   read when the compound row is first created; the row is authoritative after that.
 */
import {
  DEFAULT_BLAST_DOOR_SECONDS,
  DEFAULT_COMPOUND_SIZE_TILES,
  DEFAULT_ROOM_BUILD_SECONDS,
  MAX_BLAST_DOOR_SECONDS,
  MAX_COMPOUND_SIZE_TILES,
  MIN_BLAST_DOOR_SECONDS,
  MIN_COMPOUND_SIZE_TILES,
} from "@regulus/protocol";
import { z } from "zod";

export interface CompoundConfig {
  buildMs: number;
  sizeTiles: number;
  /** How long the blast door stays open, ms. */
  blastDoorMs: number;
}

const blankToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

const schema = z.object({
  OFFICE_ROOM_BUILD_SECONDS: z.preprocess(
    blankToUndefined,
    z.coerce.number().min(0).max(600).default(DEFAULT_ROOM_BUILD_SECONDS),
  ),
  OFFICE_BLAST_DOOR_SECONDS: z.preprocess(
    blankToUndefined,
    z.coerce
      .number()
      .min(MIN_BLAST_DOOR_SECONDS)
      .max(MAX_BLAST_DOOR_SECONDS)
      .default(DEFAULT_BLAST_DOOR_SECONDS),
  ),
  OFFICE_COMPOUND_SIZE: z.preprocess(
    blankToUndefined,
    z.coerce
      .number()
      .int()
      .min(MIN_COMPOUND_SIZE_TILES)
      .max(MAX_COMPOUND_SIZE_TILES)
      .default(DEFAULT_COMPOUND_SIZE_TILES),
  ),
});

export class CompoundConfigError extends Error {
  override name = "CompoundConfigError";
}

export function loadCompoundConfig(
  env: Record<string, string | undefined> = process.env,
): CompoundConfig {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`);
    throw new CompoundConfigError(`Invalid environment:\n${fields.join("\n")}`);
  }
  return {
    buildMs: Math.round(parsed.data.OFFICE_ROOM_BUILD_SECONDS * 1000),
    sizeTiles: parsed.data.OFFICE_COMPOUND_SIZE,
    blastDoorMs: Math.round(parsed.data.OFFICE_BLAST_DOOR_SECONDS * 1000),
  };
}
