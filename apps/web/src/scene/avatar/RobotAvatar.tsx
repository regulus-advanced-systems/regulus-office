/**
 * `<RobotAvatar>`: the Quaternius LowPoly Robot (packages/assets/models/robot)
 * as a toon-shaded, per-user coloured avatar with status antenna bulb, chest
 * light, badge and name plate (SPEC §9.3, §12). One GLB is loaded and cached
 * by drei `useGLTF`; each instance is a drei `<Clone>` (SkeletonUtils clone,
 * shared geometry) driven by its own `AnimationMixer`.
 */
import { Clone, useAnimations, useGLTF } from "@react-three/drei";
import { createPortal, type ThreeElements, useFrame } from "@react-three/fiber";
import type { AgentStatus, AvatarAnimation, AvatarLook } from "@regulus/protocol";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { type AnimationAction, type Bone, type Group, Mesh, type Object3D } from "three";
import { Antenna, Badge, ChestLight, HeadAccessory } from "./accessories.tsx";
import { ARM_CLIP_NAME, armOnlyClip, findBone, HEAD_TILT, ROBOT_MODEL_URL } from "./avatarRig.ts";
import { CROSSFADE_SECONDS, PROCEDURAL_HEAD_TILT, ROBOT_CLIPS, resolveClip } from "./clips.ts";
import { colorForRole, materialRoleFor, resolveLook } from "./colorSets.ts";
import { NamePlate } from "./NamePlate.tsx";
import type { NamePlateStyle } from "./namePlateTexture.ts";
import { bulbColorFor, bulbLitFor, handRaisedFor } from "./statusBulb.ts";
import { toonMaterialFor } from "./toonMaterial.ts";

/** Height of the model in world units after `MODEL_SCALE` (SPEC §12: ~4.5 heads tall). */
export const ROBOT_HEIGHT = 1.6;
/** robot.glb is ~2.6 armature units tall; scale it to ROBOT_HEIGHT. */
export const MODEL_SCALE = ROBOT_HEIGHT / 2.6;
const PLATE_HEIGHT = ROBOT_HEIGHT + 0.55;

export type RobotAvatarProps = Omit<ThreeElements["group"], "ref" | "children"> & {
  /** Colour set and accessory; unknown values fall back (see colorSets.ts). */
  look?: Partial<AvatarLook>;
  /** Animation from `AVATAR_ANIMATIONS`; missing clips fall back (see clips.ts). */
  animation?: AvatarAnimation;
  /** Agent status; drives the antenna bulb colour and the raised hand. Omit for humans. */
  status?: AgentStatus;
  /** Force the raised hand regardless of status (RobotState.handRaised). */
  handRaised?: boolean;
  /** Provider chest light colour (agents). Omit to hide the light. */
  chestLight?: string;
  /** Floating name plate text (humans). Omit to hide the plate. */
  name?: string;
  plateStyle?: NamePlateStyle;
  /** Show the human badge mesh. */
  badge?: boolean;
};

export function RobotAvatar({
  look,
  animation = "idle",
  status,
  handRaised,
  chestLight,
  name,
  plateStyle,
  badge = false,
  ...groupProps
}: RobotAvatarProps) {
  const gltf = useGLTF(ROBOT_MODEL_URL);
  const root = useRef<Group>(null);
  const clips = useMemo(() => {
    const wave = gltf.animations.find((c) => c.name === ROBOT_CLIPS.wave);
    return wave ? [...gltf.animations, armOnlyClip(wave)] : gltf.animations;
  }, [gltf.animations]);
  const { actions, names } = useAnimations(clips, root);
  const resolved = resolveLook(look);
  const raised = handRaised ?? handRaisedFor(status);
  const [bones, setBones] = useState<{ head: Bone; body: Bone } | null>(null);

  // Materials: swap the GLB's PBR materials for cached toon materials by role.
  useLayoutEffect(() => {
    const group = root.current;
    if (!group) return;
    group.traverse((object: Object3D) => {
      if (!(object instanceof Mesh)) return;
      const source = Array.isArray(object.material) ? object.material[0] : object.material;
      const role = (object.userData.avatarRole ??= materialRoleFor(source?.name ?? ""));
      object.material = toonMaterialFor(colorForRole(role, resolved.colors));
      object.castShadow = true;
      object.receiveShadow = true;
    });
    const head = findBone(group, "Head");
    const body = findBone(group, "Body");
    setBones((prev) => (prev?.head === head ? prev : head && body ? { head, body } : null));
  }, [resolved.colors]);

  // Animation: crossfade to the resolved clip whenever the animation changes.
  const clip = resolveClip(animation, names);
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

  // Raised hand: the right-arm tracks of the wave clip blended over the base clip.
  useEffect(() => {
    const arm = actions[ARM_CLIP_NAME];
    if (!arm) return;
    if (raised) arm.reset().fadeIn(CROSSFADE_SECONDS).play();
    else arm.fadeOut(CROSSFADE_SECONDS);
  }, [actions, raised]);

  // Procedural head tilt for "think" (runs after useAnimations' mixer update).
  const tilt = PROCEDURAL_HEAD_TILT.has(animation);
  useFrame(() => {
    if (tilt && bones) bones.head.quaternion.multiply(HEAD_TILT);
  });

  const showAntenna = status !== undefined || resolved.accessory === "antenna";
  return (
    <group {...groupProps}>
      <group scale={MODEL_SCALE}>
        <Clone ref={root} object={gltf.scene} castShadow receiveShadow />
      </group>
      {bones &&
        createPortal(
          <group>
            {showAntenna && (
              <Antenna
                bulbColor={bulbColorFor(status)}
                lit={bulbLitFor(status)}
                colors={resolved.colors}
              />
            )}
            <HeadAccessory accessory={resolved.accessory} colors={resolved.colors} />
          </group>,
          bones.head,
        )}
      {bones &&
        createPortal(
          <group>
            {chestLight && <ChestLight color={chestLight} />}
            {badge && <Badge colors={resolved.colors} />}
          </group>,
          bones.body,
        )}
      {name && <NamePlate name={name} style={plateStyle} height={PLATE_HEIGHT} />}
    </group>
  );
}

/** Start fetching the GLB before the first avatar mounts. */
export function preloadRobotModel(): void {
  useGLTF.preload(ROBOT_MODEL_URL);
}
