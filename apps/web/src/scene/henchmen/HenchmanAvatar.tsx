/**
 * `<HenchmanAvatar>` (#184, SPEC §9.3 D22): a coding agent drawn as a
 * henchman in a yellow jumpsuit (or a special skin), with its provider's
 * colour as trim and a status light on top whose colour ladder is the
 * antenna bulb's (avatar/statusBulb.ts). The raised hand (waiting for
 * permission) is the right arm held straight up over the base clip.
 *
 * One instance is one `SkinnedMesh` (geometry shared per skin, material
 * shared per skin and trim colour) with its own bones and `AnimationMixer`,
 * plus the light: two draw calls. Clicks hit an invisible box instead of the
 * skinned triangles, so hovering over 20 henchmen stays cheap.
 */
import { useAnimations } from "@react-three/drei";
import { type ThreeElements, useFrame } from "@react-three/fiber";
import type { AgentStatus, AvatarAnimation } from "@regulus/protocol";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { type AnimationAction, BoxGeometry, type Group, MeshBasicMaterial } from "three";
import { applyPose, createPoseMemo, HEAD_TILT, MODEL_YAW } from "../avatar/avatarRig.ts";
import { CROSSFADE_SECONDS, PROCEDURAL_HEAD_TILT } from "../avatar/clips.ts";
import { bulbColorFor, bulbLitFor, handRaisedFor } from "../avatar/statusBulb.ts";
import { toonMaterialFor, unlitMaterialFor } from "../avatar/toonMaterial.ts";
import { ARM_OVERLAY_WEIGHT, HENCHMAN_CLIPS, henchmanClip, henchmanClips } from "./clips.ts";
import { buildHenchman } from "./instance.ts";
import { henchmanMaterial } from "./palette.ts";
import { HENCHMAN_HEIGHT } from "./rig.ts";
import { paletteFor } from "./skins.ts";

const HIT_GEOMETRY = new BoxGeometry(0.7, HENCHMAN_HEIGHT, 0.7).translate(
  0,
  HENCHMAN_HEIGHT / 2,
  0,
);
const HIT_MATERIAL = new MeshBasicMaterial();

export type HenchmanAvatarProps = Omit<ThreeElements["group"], "ref" | "children"> & {
  /** Skin id (`HenchmanState.skin`); unknown ids wear the standard jumpsuit. */
  skin?: string;
  /** Provider trim colour; omit for the skin's own. */
  trim?: string;
  animation?: AvatarAnimation;
  /** Drives the status light and (unless `handRaised` is given) the raised hand. */
  status?: AgentStatus;
  handRaised?: boolean;
  /** Stay in the chair (seated clips for read and think). */
  seated?: boolean;
  /** The merge gong's seated cheer (#43); ignored when standing. */
  cheer?: boolean;
  /** Arms forward holding a box (the walk home, #33). */
  carrying?: boolean;
};

export function HenchmanAvatar({
  skin,
  trim,
  animation = "sit_idle",
  status,
  handRaised,
  seated = false,
  cheer = false,
  carrying = false,
  ...groupProps
}: HenchmanAvatarProps) {
  const instance = useMemo(() => buildHenchman(skin), [skin]);
  const root = useRef<Group>(null);
  const clips = useMemo(() => henchmanClips(), []);
  const { actions, mixer } = useAnimations(clips, root);
  // Read by the scene probes (tests/e2e, #159): clip weights over time; no behaviour.
  instance.group.userData.mixer = mixer;
  const raised = handRaised ?? handRaisedFor(status);

  // Look: the palette material (skin + trim) and the status light.
  useLayoutEffect(() => {
    instance.mesh.material = henchmanMaterial(paletteFor(skin, trim));
  }, [instance, skin, trim]);
  const bulb = bulbColorFor(status);
  const lit = bulbLitFor(status);
  useLayoutEffect(() => {
    instance.light.material = lit ? unlitMaterialFor(bulb) : toonMaterialFor(bulb);
  }, [instance, bulb, lit]);

  // Base clip: crossfade whenever it changes.
  const clip = henchmanClip(animation, seated, cheer);
  const current = useRef<AnimationAction | null>(null);
  useEffect(() => {
    const next = actions[clip];
    if (!next || next === current.current) return;
    const prev = current.current;
    next
      .reset()
      .fadeIn(prev ? CROSSFADE_SECONDS : 0)
      .play();
    prev?.fadeOut(CROSSFADE_SECONDS);
    current.current = next;
  }, [actions, clip]);

  useArmOverlay(actions, HENCHMAN_CLIPS.hand, raised && clip !== HENCHMAN_CLIPS.sitCheer);
  useArmOverlay(actions, HENCHMAN_CLIPS.carry, carrying);

  // Procedural head tilt for "think" (after the mixer ran).
  const tilt = PROCEDURAL_HEAD_TILT.has(animation) && clip !== HENCHMAN_CLIPS.sitCheer;
  const tiltMemo = useRef(createPoseMemo());
  useFrame(() => applyPose(instance.head, HEAD_TILT, tiltMemo.current, tilt));

  return (
    <group {...groupProps}>
      <group rotation-y={MODEL_YAW}>
        <primitive ref={root} object={instance.group} />
      </group>
      <mesh name="henchman-hit" geometry={HIT_GEOMETRY} material={HIT_MATERIAL} visible={false} />
    </group>
  );
}

/** Blend a partial arm clip in or out over the base clip (held pose, no motion). */
function useArmOverlay(
  actions: Record<string, AnimationAction | null>,
  name: string,
  on: boolean,
): void {
  useEffect(() => {
    // Read inside the effect: drei creates actions lazily once the root is mounted.
    const action = actions[name];
    if (!action) return;
    if (on) {
      action.weight = ARM_OVERLAY_WEIGHT;
      action.reset().fadeIn(CROSSFADE_SECONDS).play();
      return;
    }
    if (!action.isRunning()) return;
    action.fadeOut(CROSSFADE_SECONDS);
    // A faded-out action keeps evaluating at weight 0; stop it once the fade is over.
    const timer = setTimeout(() => action.stop(), CROSSFADE_SECONDS * 1000 + 50);
    return () => clearTimeout(timer);
  }, [actions, name, on]);
}
