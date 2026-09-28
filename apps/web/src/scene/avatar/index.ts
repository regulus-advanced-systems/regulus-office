export {
  CLIP_CANDIDATES,
  clipTable,
  ROBOT_CLIP_NAMES,
  ROBOT_CLIPS,
  resolveClip,
  resolveSeatedClip,
} from "./clips.ts";
export {
  ACCESSORIES,
  type Accessory,
  COLOR_SET_IDS,
  COLOR_SETS,
  type ColorSet,
  colorSetFor,
  PROVIDER_LIGHT_COLORS,
  providerLightColor,
  resolveLook,
} from "./colorSets.ts";
export { HUMAN_PLATE_STYLE, type NamePlateStyle } from "./namePlateTexture.ts";
export { avatarAnimationFor, presenceAnimation } from "./presence.ts";
export {
  MODEL_SCALE,
  MODEL_YAW,
  preloadRobotModel,
  ROBOT_HEIGHT,
  RobotAvatar,
  type RobotAvatarProps,
} from "./RobotAvatar.tsx";
export { BULB_COLORS, bulbColorFor, handRaisedFor } from "./statusBulb.ts";
export { getGradientMap, toonMaterialFor } from "./toonMaterial.ts";
