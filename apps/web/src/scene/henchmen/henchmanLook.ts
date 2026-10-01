/**
 * How a henchman looks, shared by everything that draws one (the desk layer and
 * #33's walk home): a henchman (#184) in the skin the OperationRoom resolved for
 * it (`HenchmanState.skin`, admin `skin_rules`) with its provider's colour as
 * trim (SPEC §9.3, D22).
 */
import type { HenchmanState } from "@regulus/protocol";
import { providerLightColor } from "../avatar/index.ts";

export interface HenchmanSkinLook {
  skin: string;
  trim: string | undefined;
}

/** Props for `<HenchmanAvatar>` that identify a henchman: `skin` and `trim`. */
export function henchmanSkinLook(
  henchman: Pick<HenchmanState, "provider" | "skin">,
): HenchmanSkinLook {
  return { skin: henchman.skin, trim: providerLightColor(henchman.provider) };
}
