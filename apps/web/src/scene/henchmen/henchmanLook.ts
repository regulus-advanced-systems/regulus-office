/**
 * How a henchman looks, shared by everything that draws one (the desk layer and
 * #33's walk home): a henchman (#184) in the skin the OperationRoom resolved for
 * it (`HenchmanState.skin`, admin `skin_rules`) with its provider's colour as
 * trim (SPEC §9.3, D22), and its own hair and skin tone, picked from its id so
 * it is the same person everywhere (#281, variety.ts).
 */
import type { HenchmanState } from "@regulus/protocol";
import { providerLightColor } from "../avatar/index.ts";

export interface HenchmanSkinLook {
  skin: string;
  trim: string | undefined;
  /** What the hair and skin tone are picked from. */
  seed: string;
}

/** Props for `<HenchmanAvatar>` that identify a henchman: `skin`, `trim` and `seed`. */
export function henchmanSkinLook(
  henchman: Pick<HenchmanState, "agentId" | "provider" | "skin">,
): HenchmanSkinLook {
  return {
    skin: henchman.skin,
    trim: providerLightColor(henchman.provider),
    seed: henchman.agentId,
  };
}
