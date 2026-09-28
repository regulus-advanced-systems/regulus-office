/**
 * How a robot looks, shared by everything that draws one (the desk layer and
 * #33's walk home): a colour set per owner so one human's robots look alike,
 * the antenna accessory, and the provider's chest light (SPEC §9.3).
 */
import type { AvatarLook, RobotState } from "@regulus/protocol";
import { COLOR_SET_IDS, providerLightColor } from "../avatar/index.ts";

/** Stable colour set per owner id. */
export function colorSetForOwner(ownerUserId: string): string {
  let h = 0;
  for (let i = 0; i < ownerUserId.length; i++) h = (h * 31 + ownerUserId.charCodeAt(i)) >>> 0;
  return COLOR_SET_IDS[h % COLOR_SET_IDS.length] ?? "teal";
}

export interface RobotAvatarLook {
  look: AvatarLook;
  chestLight: string | undefined;
}

/** Props for `<RobotAvatar>` that identify a robot: `look` and `chestLight`. */
export function robotAvatarLook(
  robot: Pick<RobotState, "ownerUserId" | "provider">,
): RobotAvatarLook {
  return {
    look: { colorSet: colorSetForOwner(robot.ownerUserId), accessory: "antenna" },
    chestLight: providerLightColor(robot.provider),
  };
}
