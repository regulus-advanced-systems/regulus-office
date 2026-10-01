/**
 * The merge gong's seated cheer (#43) on the real robot.glb, crossfaded the
 * way RobotAvatar does it: the arms and head dance and the upper body sways,
 * the legs, hips and body never leave the seated pose, and after the cheer every bone is back
 * exactly where the still seated pose (#159) holds it.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { AnimationMixer, type Bone, type Object3D, Quaternion, Vector3 } from "three";
import { type GLTF, GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";
import { findBone, ROBOT_MODEL_URL } from "./avatarRig.ts";
import { CROSSFADE_SECONDS, ROBOT_CLIPS } from "./clips.ts";
import { CHEER_BONES, CHEER_SWAY, SEATED_CLIPS, seatedClips } from "./seatedClips.ts";

function loadGlb(url: string): Promise<GLTF> {
  const bytes = readFileSync(fileURLToPath(url));
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return new Promise((resolve, reject) => new GLTFLoader().parse(buffer, "", resolve, reject));
}

const henchman = await loadGlb(ROBOT_MODEL_URL);

function bones(root: Object3D): Bone[] {
  const out: Bone[] = [];
  root.traverse((o) => {
    if ((o as Bone).isBone) out.push(o as Bone);
  });
  return out;
}

type Pose = Map<string, { q: Quaternion; p: Vector3 }>;
const snapshot = (list: Bone[]): Pose =>
  new Map(list.map((b) => [b.name, { q: b.quaternion.clone(), p: b.position.clone() }]));
/** Angle between a bone's rotations in two poses, radians (exactly 0 when equal; no acos rounding). */
function turned(a: Pose, b: Pose, bone: string): number {
  const x = a.get(bone)?.q.toArray() ?? [0, 0, 0, 1];
  const y = b.get(bone)?.q.toArray() ?? [0, 0, 0, 1];
  const sign = x.reduce((s, v, i) => s + v * (y[i] ?? 0), 0) < 0 ? -1 : 1;
  const diff = Math.hypot(...x.map((v, i) => v - sign * (y[i] ?? 0)));
  const sum = Math.hypot(...x.map((v, i) => v + sign * (y[i] ?? 0)));
  return 4 * Math.atan2(diff, sum);
}

describe("seated cheer on robot.glb (#43)", () => {
  test("dances the upper body in the chair and ends in exactly the seated pose", () => {
    const sitting = henchman.animations.find((c) => c.name === ROBOT_CLIPS.sitting);
    const dance = henchman.animations.find((c) => c.name === ROBOT_CLIPS.dance);
    if (!sitting || !dance) throw new Error("robot.glb lacks the sitting or dance clip");
    const clips = seatedClips(
      sitting,
      (b) => findBone(henchman.scene, b)?.quaternion.toArray(),
      dance,
    );
    const idleClip = clips.find((c) => c.name === SEATED_CLIPS.idle);
    const cheerClip = clips.find((c) => c.name === SEATED_CLIPS.cheer);
    if (!idleClip || !cheerClip) throw new Error("seated clips missing");
    // About 3 s: the length of the dance.
    expect(cheerClip.duration).toBeGreaterThan(2.5);
    expect(cheerClip.duration).toBeLessThan(4);

    const instance = cloneSkeleton(henchman.scene);
    const list = bones(instance);
    const mixer = new AnimationMixer(instance);
    const idle = mixer.clipAction(idleClip);
    const cheer = mixer.clipAction(cheerClip);
    idle.play();
    mixer.update(0.5);
    const seated = snapshot(list);

    // The ring: crossfade into the cheer (RobotAvatar's clip effect), 3 s of it.
    cheer.reset().fadeIn(CROSSFADE_SECONDS).play();
    idle.fadeOut(CROSSFADE_SECONDS);
    let armsMoved = 0;
    let legsMoved = 0;
    const still = list
      .map((b) => b.name)
      .filter((n) => !CHEER_BONES.includes(n) && n !== CHEER_SWAY.bone);
    for (let t = 0; t < 3; t += 1 / 30) {
      mixer.update(1 / 30);
      const now = snapshot(list);
      armsMoved = Math.max(
        armsMoved,
        turned(seated, now, "UpperArmL"),
        turned(seated, now, "UpperArmR"),
      );
      for (const name of still) legsMoved = Math.max(legsMoved, turned(seated, now, name));
    }
    expect(armsMoved).toBeGreaterThan(0.3);
    expect(legsMoved).toBeLessThan(1e-6);

    // Over: crossfade back to the still pose, then hold.
    idle.reset().fadeIn(CROSSFADE_SECONDS).play();
    cheer.fadeOut(CROSSFADE_SECONDS);
    for (let t = 0; t < 1; t += 1 / 30) mixer.update(1 / 30);
    const after = snapshot(list);
    for (const b of list) {
      expect([b.name, turned(seated, after, b.name) < 1e-6]).toEqual([b.name, true]);
      const moved = seated.get(b.name)?.p.distanceTo(after.get(b.name)?.p ?? new Vector3()) ?? 1;
      expect([b.name, moved < 1e-6]).toEqual([b.name, true]);
    }
    // And still from then on (#159).
    mixer.update(2);
    const later = snapshot(list);
    for (const b of list) expect(turned(after, later, b.name)).toBeLessThan(1e-6);
  });
});
