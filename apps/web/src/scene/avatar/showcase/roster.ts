/** Deterministic roster of showcase henchmen cycling through every look, status and animation. */
import {
  AGENT_STATUSES,
  type AgentStatus,
  AVATAR_ANIMATIONS,
  type AvatarAnimation,
  PROVIDER_IDS,
} from "@regulus/protocol";
import { ACCESSORIES, COLOR_SET_IDS, providerLightColor } from "../colorSets.ts";
import type { RobotAvatarProps } from "../RobotAvatar.tsx";

const NAMES = [
  "Ada",
  "Grace",
  "Linus",
  "Margaret",
  "Dennis",
  "Barbara",
  "Ken",
  "Radia",
  "Alan",
  "Hedy",
];

export type ShowcaseHenchman = { key: string; props: RobotAvatarProps };

export type RosterOverrides = { animation?: AvatarAnimation; status?: AgentStatus };

export function showcaseHenchmen(
  count: number,
  overrides: RosterOverrides = {},
): ShowcaseHenchman[] {
  const columns = Math.ceil(Math.sqrt(count));
  const spacing = 2.4;
  const henchmen: ShowcaseHenchman[] = [];
  for (let i = 0; i < count; i++) {
    const col = i % columns;
    const row = Math.floor(i / columns);
    const x = (col - (columns - 1) / 2) * spacing;
    const z = (row - (Math.ceil(count / columns) - 1) / 2) * spacing;
    const human = i % 3 === 2;
    const look = {
      colorSet: COLOR_SET_IDS[i % COLOR_SET_IDS.length] ?? "teal",
      accessory: ACCESSORIES[i % ACCESSORIES.length] ?? "antenna",
    };
    const animation =
      overrides.animation ?? AVATAR_ANIMATIONS[i % AVATAR_ANIMATIONS.length] ?? "idle";
    const base: RobotAvatarProps = {
      look,
      animation,
      position: [x, 0, z],
      // Heading that faces the iso camera (+x, +z).
      rotation: [0, (-3 * Math.PI) / 4, 0],
    };
    henchmen.push({
      key: `henchman-${i}`,
      props: human
        ? { ...base, name: NAMES[i % NAMES.length] ?? "Human", badge: true }
        : {
            ...base,
            status: overrides.status ?? AGENT_STATUSES[i % AGENT_STATUSES.length] ?? "idle",
            chestLight: providerLightColor(PROVIDER_IDS[i % PROVIDER_IDS.length] ?? "custom"),
          },
    });
  }
  return henchmen;
}
