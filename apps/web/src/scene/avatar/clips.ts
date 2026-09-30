/**
 * Animation clip names of packages/assets/models/robot/robot.glb and the
 * mapping from the SPEC §9.3 avatar animation enum (`AVATAR_ANIMATIONS` in
 * @regulus/protocol) to those clips, with fallbacks for clips the Quaternius
 * model does not ship.
 */
import type { AvatarAnimation } from "@regulus/protocol";
import { SEATED_CLIPS } from "./seatedClips.ts";

/** Clips that exist in robot.glb (Quaternius Animated LowPoly Robot). */
export const ROBOT_CLIPS = {
  dance: "RobotArmature|Robot_Dance",
  death: "RobotArmature|Robot_Death",
  idle: "RobotArmature|Robot_Idle",
  jump: "RobotArmature|Robot_Jump",
  no: "RobotArmature|Robot_No",
  punch: "RobotArmature|Robot_Punch",
  running: "RobotArmature|Robot_Running",
  sitting: "RobotArmature|Robot_Sitting",
  standing: "RobotArmature|Robot_Standing",
  thumbsUp: "RobotArmature|Robot_ThumbsUp",
  walking: "RobotArmature|Robot_Walking",
  walkJump: "RobotArmature|Robot_WalkJump",
  wave: "RobotArmature|Robot_Wave",
  yes: "RobotArmature|Robot_Yes",
} as const;

export const ROBOT_CLIP_NAMES: readonly string[] = Object.values(ROBOT_CLIPS);

/**
 * Every clip a `RobotAvatar` has: the GLB's plus the seated clips it builds
 * from `Robot_Sitting` (seatedClips.ts, #159).
 */
export const AVATAR_CLIP_NAMES: readonly string[] = [
  ...ROBOT_CLIP_NAMES,
  ...Object.values(SEATED_CLIPS),
];

/**
 * Candidate clips per avatar animation, best first. Names that are not in the
 * loaded GLB are skipped, so a future re-export with dedicated clips (for
 * example `RobotArmature|Robot_SitType`) is picked up without code changes.
 */
export const CLIP_CANDIDATES: Record<AvatarAnimation, readonly string[]> = {
  idle: [ROBOT_CLIPS.idle, ROBOT_CLIPS.standing],
  walk: [ROBOT_CLIPS.walking, ROBOT_CLIPS.running],
  // Robot_Sitting is a sit-down transition, not a loop: only a last resort (#159).
  sit_type: ["RobotArmature|Robot_SitType", SEATED_CLIPS.type, ROBOT_CLIPS.sitting],
  sit_idle: ["RobotArmature|Robot_SitIdle", SEATED_CLIPS.idle, ROBOT_CLIPS.sitting],
  read: ["RobotArmature|Robot_Read", ROBOT_CLIPS.idle],
  think: ["RobotArmature|Robot_Think", ROBOT_CLIPS.idle],
  celebrate: ["RobotArmature|Robot_Celebrate", ROBOT_CLIPS.dance],
  facepalm: ["RobotArmature|Robot_Facepalm", ROBOT_CLIPS.no],
  wave: [ROBOT_CLIPS.wave],
  point: ["RobotArmature|Robot_Point", ROBOT_CLIPS.thumbsUp],
};

/** Last resort when no candidate is available. */
export const FALLBACK_CLIP = ROBOT_CLIPS.idle;

/** Seconds for the crossfade between two clips. */
export const CROSSFADE_SECONDS = 0.25;

/**
 * Animations whose chosen clip is a stand-in for something the model cannot
 * show; the component layers a small procedural pose on top (SPEC §9.3:
 * "think (head tilt)").
 */
export const PROCEDURAL_HEAD_TILT: ReadonlySet<AvatarAnimation> = new Set(["think"]);

/**
 * Animations that should play while seated, so a `sit_*` clip keeps the legs
 * folded even when a one-shot emote is requested from a chair.
 */
export const SEATED_ANIMATIONS: ReadonlySet<AvatarAnimation> = new Set(["sit_type", "sit_idle"]);

/** Resolve one animation to a clip that exists in `available`. */
export function resolveClip(
  animation: AvatarAnimation,
  available: readonly string[] = AVATAR_CLIP_NAMES,
): string {
  const set = new Set(available);
  for (const candidate of CLIP_CANDIDATES[animation]) {
    if (set.has(candidate)) return candidate;
  }
  if (set.has(FALLBACK_CLIP)) return FALLBACK_CLIP;
  return available[0] ?? FALLBACK_CLIP;
}

/** Full animation → clip table for one loaded model. */
export function clipTable(
  available: readonly string[] = AVATAR_CLIP_NAMES,
): Record<AvatarAnimation, string> {
  const table = {} as Record<AvatarAnimation, string>;
  for (const animation of Object.keys(CLIP_CANDIDATES) as AvatarAnimation[]) {
    table[animation] = resolveClip(animation, available);
  }
  return table;
}

/** True when the animation had to fall back to a stand-in clip. */
export function isFallbackClip(animation: AvatarAnimation, clip: string): boolean {
  return CLIP_CANDIDATES[animation][0] !== clip;
}

/** Seated stand-ins for animations the model only has standing (or not at all). */
const SEATED_STAND_INS: Partial<Record<AvatarAnimation, string>> = {
  read: SEATED_CLIPS.read,
  think: SEATED_CLIPS.think,
};

/**
 * Clip for a robot that stays in its chair: seated animations whose own clip
 * is missing (read, think) use a seated stand-in (seatedClips.ts), else the
 * still seated pose, instead of a standing idle, so the robot does not stand
 * up to read. Procedural layers (the think head tilt, papers) still apply on
 * top.
 */
export function resolveSeatedClip(
  animation: AvatarAnimation,
  available: readonly string[] = AVATAR_CLIP_NAMES,
): string {
  if (SEATED_ANIMATIONS.has(animation)) return resolveClip(animation, available);
  const own = CLIP_CANDIDATES[animation][0];
  if (own && available.includes(own)) return own;
  const standIn = SEATED_STAND_INS[animation];
  if (standIn && available.includes(standIn)) return standIn;
  return resolveClip("sit_idle", available);
}

/**
 * The clip an avatar plays: the seated cheer of the merge gong (#43) while a
 * seated robot cheers (when the model has it), else its animation's clip,
 * seated or standing. Once `cheer` ends it is the animation's clip again, so
 * the robot crossfades back to exactly the seated pose it had.
 */
export function avatarClip(
  animation: AvatarAnimation,
  seated: boolean,
  cheer: boolean,
  available: readonly string[] = AVATAR_CLIP_NAMES,
): string {
  if (cheer && seated && available.includes(SEATED_CLIPS.cheer)) return SEATED_CLIPS.cheer;
  return seated ? resolveSeatedClip(animation, available) : resolveClip(animation, available);
}
