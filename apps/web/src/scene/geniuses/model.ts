/**
 * Genius instances: one merged, skinned geometry per archetype + accessory
 * (cached; colours come from the palette material), and per avatar its own
 * bones and SkinnedMesh around the shared geometry.
 */
import {
  type GeniusAccessory,
  type GeniusArchetype,
  type GeniusLookValue,
} from "@regulus/protocol";
import {
  type Bone,
  type BufferGeometry,
  Group,
  Skeleton,
  SkinnedMesh,
  Sphere,
  Vector3,
} from "three";
import { MODEL_YAW } from "../avatar/avatarRig.ts";
import { ARCHETYPE_MODELS } from "./archetypes.ts";
import { geniusMaterial } from "./palette.ts";
import { PartBuilder } from "./parts.ts";
import { createBones } from "./rig.ts";

const geometries = new Map<string, BufferGeometry>();

/** The merged body + accessory geometry, built on first use. */
export function geniusGeometry(
  archetype: GeniusArchetype,
  accessory: GeniusAccessory,
): BufferGeometry {
  const key = `${archetype}/${accessory}`;
  let geometry = geometries.get(key);
  if (!geometry) {
    const model = ARCHETYPE_MODELS[archetype];
    const parts = new PartBuilder();
    model.build(parts);
    model.accessory(parts, accessory);
    geometry = parts.build();
    geometries.set(key, geometry);
  }
  return geometry;
}

export interface GeniusInstance {
  /** Turned by MODEL_YAW so callers set `rotation.y = heading` (face-first, like robots). */
  root: Group;
  mesh: SkinnedMesh;
  bones: Bone[];
}

export function createGenius(look: GeniusLookValue): GeniusInstance {
  const model = ARCHETYPE_MODELS[look.archetype];
  const bones = createBones(model.body);
  const mesh = new SkinnedMesh(
    geniusGeometry(look.archetype, look.accessory),
    geniusMaterial(look),
  );
  mesh.name = `genius-${look.archetype}`;
  mesh.add(bones[0] as Bone);
  mesh.bind(new Skeleton(bones));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  // Generous fixed bounds: poses (sitting, arms up) stay inside, no per-frame recompute.
  mesh.boundingSphere = new Sphere(
    new Vector3(0, model.body.height / 2, 0),
    model.body.height * 0.75,
  );
  const root = new Group();
  root.rotation.y = MODEL_YAW;
  root.add(mesh);
  return { root, mesh, bones };
}
