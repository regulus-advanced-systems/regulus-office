/**
 * `<GeniusAvatar>`: a human's genius (SPEC §9.3, D22) with its floating
 * name plate. One SkinnedMesh per avatar (one draw call) around a cached
 * archetype geometry; colours are a palette material; clips are procedural
 * (clips/) and crossfade like the henchmen's. The model faces the group's
 * heading (MODEL_YAW), so callers set `rotation.y = heading` exactly as
 * they did for the robot-model avatar before them: face-first walking and cursor turning are
 * unchanged.
 */
import { type ThreeElements, useFrame } from "@react-three/fiber";
import {
  type AvatarAnimation,
  type GeniusLookValue,
  geniusLookKey,
  resolveGeniusLook,
} from "@regulus/protocol";
import { useEffect, useMemo, useRef } from "react";
import { type AnimationAction, AnimationMixer } from "three";
import { CROSSFADE_SECONDS } from "../avatar/clips.ts";
import { NamePlate } from "../avatar/NamePlate.tsx";
import { HUMAN_PLATE_STYLE, type NamePlateStyle } from "../avatar/namePlateTexture.ts";
import type { Gait } from "../movement/gait.ts";
import { ARCHETYPE_MODELS } from "./archetypes.ts";
import { geniusClipName, geniusClips } from "./clips/index.ts";
import { createGenius } from "./model.ts";

export type GeniusAvatarProps = Omit<ThreeElements["group"], "ref" | "children"> & {
  /** Archetype, colours and accessory; unknown values fall back (protocol resolveGeniusLook). */
  look?: Partial<Record<keyof GeniusLookValue, string>> | null;
  animation?: AvatarAnimation;
  /** Keep the legs folded for emotes (a human on a seat). */
  seated?: boolean;
  /** Walking or running while `animation` is "walk" (#223). */
  gait?: Gait;
  /** Floating name plate text. Omit to hide the plate (picker preview). */
  name?: string;
  plateStyle?: NamePlateStyle;
};

/** Gap between the top of the head (or hat) and the name plate. */
const PLATE_GAP = 0.3;

export function GeniusAvatar({
  look: lookProp,
  animation = "idle",
  seated = false,
  gait = "walk",
  name,
  plateStyle = HUMAN_PLATE_STYLE,
  ...groupProps
}: GeniusAvatarProps) {
  const look = resolveGeniusLook(lookProp);
  const key = geniusLookKey(look);
  const genius = useMemo(() => createGenius(look), [key]);
  const model = ARCHETYPE_MODELS[look.archetype];
  const mixer = useMemo(() => new AnimationMixer(genius.mesh), [genius]);
  // Read by scene probes (tests/e2e): which genius this is and its clip weights.
  genius.root.userData.genius = look;
  genius.root.userData.mixer = mixer;

  const clipName = geniusClipName(animation, seated, gait);
  const current = useRef<{ action: AnimationAction; name: string } | null>(null);
  useEffect(() => {
    const clip = geniusClips(model).find((c) => c.name === clipName);
    if (!clip) return;
    const action = mixer.clipAction(clip);
    const prev = current.current;
    if (prev?.action === action) return;
    action
      .reset()
      .fadeIn(prev ? CROSSFADE_SECONDS : 0)
      .play();
    prev?.action.fadeOut(CROSSFADE_SECONDS);
    current.current = { action, name: clipName };
  }, [mixer, model, clipName]);

  // A new look builds a new mesh: drop the old mixer's actions with it.
  useEffect(
    () => () => {
      mixer.stopAllAction();
      mixer.uncacheRoot(genius.mesh);
      current.current = null;
    },
    [mixer, genius],
  );

  useFrame((_, delta) => {
    mixer.update(Math.min(delta, 0.1));
  });

  return (
    <group {...groupProps}>
      <primitive object={genius.root} />
      {name && <NamePlate name={name} style={plateStyle} height={model.body.height + PLATE_GAP} />}
    </group>
  );
}
