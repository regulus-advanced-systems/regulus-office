/**
 * How a robot looks, shared by everything that draws one (the desk layer and
 * #33's walk home): a henchman (#184) in the skin the FloorRoom resolved for
 * it (`RobotState.skin`, admin `skin_rules`) with its provider's colour as
 * trim (SPEC §9.3, D22).
 */
import type { RobotState } from "@regulus/protocol";
import { providerLightColor } from "../avatar/index.ts";

export interface RobotHenchmanLook {
  skin: string;
  trim: string | undefined;
}

/** Props for `<HenchmanAvatar>` that identify a robot: `skin` and `trim`. */
export function robotHenchmanLook(robot: Pick<RobotState, "provider" | "skin">): RobotHenchmanLook {
  return { skin: robot.skin, trim: providerLightColor(robot.provider) };
}
