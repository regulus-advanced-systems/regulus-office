/**
 * The genius models (#185): every archetype and accessory builds one skinned
 * geometry within the triangle budget, stands on the floor at its stated
 * height, faces +z (so MODEL_YAW turns it to the heading, face-first like
 * the robots), and every animation has a clip that drives every bone.
 */
import { describe, expect, test } from "bun:test";
import {
  AVATAR_ANIMATIONS,
  accessoriesFor,
  DEFAULT_GENIUS_LOOK,
  GENIUS_ARCHETYPES,
} from "@regulus/protocol";
import { AnimationMixer, Box3, Group, Vector3 } from "three";
import { SEATED_HIPS, SEATED_SIT_DROP } from "../avatar/seatedFit.ts";
import { headingOfTravel } from "../movement/kinematics.ts";
import { ARCHETYPE_MODELS } from "./archetypes.ts";
import { GENIUS_CLIP_NAMES, geniusClipName, geniusClips } from "./clips/index.ts";
import { seatedHips } from "./clips/lower.ts";
import { createGenius, geniusGeometry } from "./model.ts";
import { SLOT, slotU } from "./palette.ts";
import { BONES, boneNodeName } from "./rig.ts";

/** Most triangles one genius may have (SPEC §11: a few humans next to 20 robots on an iGPU). */
export const GENIUS_TRIANGLE_BUDGET = 2000;

describe("genius geometry", () => {
  for (const archetype of GENIUS_ARCHETYPES) {
    const model = ARCHETYPE_MODELS[archetype];
    for (const accessory of accessoriesFor(archetype)) {
      test(`${archetype} with ${accessory}: one rigid skinned mesh within budget`, () => {
        const geo = geniusGeometry(archetype, accessory);
        const n = geo.getAttribute("position").count;
        expect(geo.index).toBeNull();
        expect(n / 3).toBeLessThanOrEqual(GENIUS_TRIANGLE_BUDGET);
        const skinIndex = geo.getAttribute("skinIndex");
        const skinWeight = geo.getAttribute("skinWeight");
        for (let i = 0; i < n; i++) {
          expect(skinIndex.getX(i)).toBeLessThan(BONES.length);
          expect(skinWeight.getX(i)).toBe(1);
        }
        const box = new Box3().setFromBufferAttribute(geo.getAttribute("position") as never);
        expect(box.min.y).toBeGreaterThan(-0.02);
        expect(box.min.y).toBeLessThan(0.03);
        const top = model.body.height + (model.extraHeight?.(accessory) ?? 0);
        expect(Math.abs(box.max.y - top)).toBeLessThan(0.2);
      });
    }
  }

  test("the face is on the +z side: eyes are the frontmost skin-level detail", () => {
    for (const archetype of GENIUS_ARCHETYPES) {
      const geo = geniusGeometry(archetype, "none");
      const pos = geo.getAttribute("position");
      const uv = geo.getAttribute("uv");
      let eyeZ = Number.NEGATIVE_INFINITY;
      for (let i = 0; i < pos.count; i++) {
        if (Math.abs(uv.getX(i) - slotU(SLOT.eyeWhite)) < 1e-6) eyeZ = Math.max(eyeZ, pos.getZ(i));
      }
      expect(eyeZ).toBeGreaterThan(0.12);
    }
  });
});

describe("genius facing", () => {
  test("a genius in a group turned to the heading of travel faces where it walks", () => {
    const genius = createGenius({ ...DEFAULT_GENIUS_LOOK, archetype: "general" });
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
      [1, 1],
    ] as const) {
      const avatar = new Group(); // LocalAvatar / RemoteAvatar: rotation.y = heading
      avatar.rotation.y = headingOfTravel(dx, dz);
      avatar.add(genius.root);
      avatar.updateMatrixWorld(true);
      const forward = new Vector3(0, 0, 1).transformDirection(genius.mesh.matrixWorld);
      expect(forward.dot(new Vector3(dx, 0, dz).normalize())).toBeCloseTo(1, 6);
      avatar.remove(genius.root);
    }
  });
});

describe("genius clips", () => {
  test("every animation, standing or seated, plays a built clip", () => {
    for (const animation of AVATAR_ANIMATIONS) {
      for (const seated of [false, true]) {
        expect(GENIUS_CLIP_NAMES).toContain(geniusClipName(animation, seated));
      }
    }
    expect(geniusClipName("wave", true)).toBe("wave.seated");
    expect(geniusClipName("idle", true)).toBe("sit_idle");
    expect(geniusClipName("walk", false)).toBe("walk");
  });

  test("every clip drives every bone, and loops seamlessly", () => {
    for (const archetype of GENIUS_ARCHETYPES) {
      const clips = geniusClips(ARCHETYPE_MODELS[archetype]);
      expect(clips.map((c) => c.name).sort()).toEqual([...GENIUS_CLIP_NAMES].sort());
      for (const clip of clips) {
        const names = clip.tracks.map((t) => t.name);
        for (const bone of BONES) expect(names).toContain(`${boneNodeName(bone)}.quaternion`);
        expect(names).toContain(`${boneNodeName("hips")}.position`);
        for (const track of clip.tracks) {
          const size = track.getValueSize();
          const first = Array.from(track.values.slice(0, size));
          const last = Array.from(track.values.slice(-size));
          first.forEach((v, i) => expect(v).toBeCloseTo(last[i] ?? Number.NaN, 4));
        }
      }
    }
  });

  test("the clips bind to the mesh: the walk moves the legs", () => {
    const genius = createGenius(DEFAULT_GENIUS_LOOK);
    const mixer = new AnimationMixer(genius.mesh);
    const walk = geniusClips(ARCHETYPE_MODELS.mastermind).find((c) => c.name === "walk");
    if (!walk) throw new Error("walk missing");
    mixer.clipAction(walk).play();
    const thigh = genius.mesh.getObjectByName(boneNodeName("thighL"));
    mixer.update(walk.duration / 4);
    const a = thigh?.quaternion.clone();
    mixer.update(walk.duration / 2);
    expect(a?.angleTo(thigh?.quaternion ?? a)).toBeGreaterThan(0.5);
  });

  test("seated hips sit where a seated robot's do, so seats fit (avatar/seatedFit.ts)", () => {
    for (const archetype of GENIUS_ARCHETYPES) {
      const body = ARCHETYPE_MODELS[archetype].body;
      const [, y, z] = seatedHips(body);
      expect(y - body.seatDrop).toBeCloseTo(SEATED_HIPS.up - SEATED_SIT_DROP, 6);
      expect(z).toBeLessThan(0);
      expect(z).toBeGreaterThan(-SEATED_HIPS.back - 0.3);
    }
  });
});
