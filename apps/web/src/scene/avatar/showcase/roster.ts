/** Deterministic roster of showcase robots cycling through every look, status and animation. */
import { AGENT_STATUSES, AVATAR_ANIMATIONS, PROVIDER_IDS } from "@regulus/protocol";
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

export type ShowcaseRobot = { key: string; props: RobotAvatarProps };

export function showcaseRobots(count: number): ShowcaseRobot[] {
  const columns = Math.ceil(Math.sqrt(count));
  const spacing = 2.4;
  const robots: ShowcaseRobot[] = [];
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
    const animation = AVATAR_ANIMATIONS[i % AVATAR_ANIMATIONS.length] ?? "idle";
    const base: RobotAvatarProps = {
      look,
      animation,
      position: [x, 0, z],
      rotation: [0, Math.PI / 4, 0],
    };
    robots.push({
      key: `robot-${i}`,
      props: human
        ? { ...base, name: NAMES[i % NAMES.length] ?? "Human", badge: true }
        : {
            ...base,
            status: AGENT_STATUSES[i % AGENT_STATUSES.length] ?? "idle",
            chestLight: providerLightColor(PROVIDER_IDS[i % PROVIDER_IDS.length] ?? "custom"),
          },
    });
  }
  return robots;
}
