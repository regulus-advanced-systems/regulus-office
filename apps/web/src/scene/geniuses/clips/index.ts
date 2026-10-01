/**
 * Every clip a genius plays (SPEC §9.3 animation enum), built once per
 * archetype from its proportions and motion style: idle, walk, sit_idle,
 * sit_type and the emotes (read, think, celebrate, facepalm, wave, point),
 * standing and seated.
 */
import type { AvatarAnimation, GeniusArchetype } from "@regulus/protocol";
import type { AnimationClip } from "three";
import type { ArchetypeModel } from "../bodies/types.ts";
import { seated, standing, walking } from "./lower.ts";
import { layer, sampleClip } from "./pose.ts";
import { emoteArms, idleArms, lapArms, typingArms } from "./upper.ts";

/** Emotes with a standing and a seated clip. */
export const GENIUS_EMOTES = ["read", "think", "celebrate", "facepalm", "wave", "point"] as const;

export const SEATED_SUFFIX = ".seated";

/** Clip name for an animation; seated humans keep their legs folded for emotes. */
export function geniusClipName(animation: AvatarAnimation, seatedNow: boolean): string {
  if (animation === "sit_idle" || animation === "sit_type") return animation;
  if (animation === "walk") return "walk";
  if (animation === "idle") return seatedNow ? "sit_idle" : "idle";
  return seatedNow ? `${animation}${SEATED_SUFFIX}` : animation;
}

/** Every clip name `geniusClips` builds. */
export const GENIUS_CLIP_NAMES: readonly string[] = [
  "idle",
  "walk",
  "sit_idle",
  "sit_type",
  ...GENIUS_EMOTES,
  ...GENIUS_EMOTES.map((e) => `${e}${SEATED_SUFFIX}`),
];

const cache = new Map<GeniusArchetype, AnimationClip[]>();

export function geniusClips(model: ArchetypeModel): AnimationClip[] {
  const cached = cache.get(model.id);
  if (cached) return cached;
  const { body, style } = model;
  const walkArms = () => (style.walkKeepsArms ? idleArms(style.idle, 0) : { rot: {} });
  const clips = [
    sampleClip("idle", body, 4, 24, (p) => layer(standing(style, p), idleArms(style.idle, p))),
    sampleClip("walk", body, 0.72, 16, (p) => layer(walking(style, p), walkArms())),
    sampleClip("sit_idle", body, 4, 16, (p) => layer(seated(body, p), lapArms())),
    sampleClip("sit_type", body, 0.6, 12, (p) => layer(seated(body, p, 8), typingArms(p))),
    ...GENIUS_EMOTES.flatMap((emote) => [
      sampleClip(emote, body, 2, 24, (p) =>
        layer(standing(style, p), emoteArms(emote, p), bounce(emote, p)),
      ),
      sampleClip(`${emote}${SEATED_SUFFIX}`, body, 2, 24, (p) =>
        layer(seated(body, p), emoteArms(emote, p)),
      ),
    ]),
  ];
  cache.set(model.id, clips);
  return clips;
}

/** Celebrations hop. */
function bounce(emote: string, phase: number) {
  if (emote !== "celebrate") return { rot: {} };
  return {
    hips: [0, 0.07 * Math.abs(Math.sin(Math.PI * 4 * phase)), 0] as [number, number, number],
    rot: {},
  };
}
