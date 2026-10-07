/**
 * One henchman's scene graph (#184): a `SkinnedMesh` on the form's shared
 * geometry with its own bones, and the status light (the two shoulder lamps,
 * one mesh) on the Body bone. Used by `<HenchmanAvatar>` and by the tests,
 * which pose it with a mixer.
 */
import { type Bone, Group, Mesh, SkinnedMesh, Sphere, Vector3 } from "three";
import { bindPosition, buildSkeleton } from "./rig.ts";
import { buildOf, lightAt, skinGeometry } from "./skins.ts";
import { lightGeometry } from "./statusLight.ts";
import { type CrewVariant, DEFAULT_VARIANT } from "./variety.ts";

/** Every pose stays inside this sphere (model space), for frustum culling. */
const POSE_BOUNDS = new Sphere(new Vector3(0, 0.9, 0.1), 1.35);

export interface Instance {
  group: Group;
  mesh: SkinnedMesh;
  head: Bone;
  light: Mesh;
}

/** A henchman in the form `skin`, in its bind pose, facing +z. Materials are set by the caller. */
export function buildHenchman(
  skin: string | undefined,
  variant: CrewVariant = DEFAULT_VARIANT,
): Instance {
  const { root, bones, skeleton } = buildSkeleton();
  const mesh = new SkinnedMesh(skinGeometry(skin, variant));
  mesh.name = "henchman";
  mesh.add(root);
  mesh.bind(skeleton);
  mesh.boundingSphere = POSE_BOUNDS.clone();
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.raycast = () => {};
  const head = bones.find((b) => b.name === "Head") as Bone;
  const chest = bones.find((b) => b.name === "Body") as Bone;
  const light = new Mesh(lightGeometry(buildOf(skin)));
  light.name = "statusLight";
  light.raycast = () => {};
  light.position.copy(new Vector3(...lightAt(skin)).sub(bindPosition("Body")));
  chest.add(light);
  const group = new Group();
  group.add(mesh);
  return { group, mesh, head, light };
}
