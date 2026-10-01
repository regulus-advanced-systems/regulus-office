/**
 * One henchman's scene graph (#184): a `SkinnedMesh` on the skin's shared
 * geometry with its own bones, and the status light on the head bone. Used
 * by `<HenchmanAvatar>` and by the tests, which pose it with a mixer.
 */
import { type Bone, Group, Mesh, SkinnedMesh, Sphere, SphereGeometry, Vector3 } from "three";
import { LIGHT_RADIUS } from "./headwear.ts";
import { bindPosition, buildSkeleton } from "./rig.ts";
import { lightAt, skinGeometry } from "./skins.ts";

const LIGHT_GEOMETRY = new SphereGeometry(LIGHT_RADIUS, 12, 8);
/** Every pose stays inside this sphere (model space), for frustum culling. */
const POSE_BOUNDS = new Sphere(new Vector3(0, 0.8, 0.1), 1.25);

export interface Instance {
  group: Group;
  mesh: SkinnedMesh;
  head: Bone;
  light: Mesh;
}

/** A henchman wearing `skin`, in its bind pose, facing +z. Materials are set by the caller. */
export function buildHenchman(skin: string | undefined): Instance {
  const { root, bones, skeleton } = buildSkeleton();
  const mesh = new SkinnedMesh(skinGeometry(skin));
  mesh.name = "henchman";
  mesh.add(root);
  mesh.bind(skeleton);
  mesh.boundingSphere = POSE_BOUNDS.clone();
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.raycast = () => {};
  const head = bones.find((b) => b.name === "Head") as Bone;
  const light = new Mesh(LIGHT_GEOMETRY);
  light.name = "statusLight";
  light.raycast = () => {};
  light.position.copy(new Vector3(...lightAt(skin)).sub(bindPosition("Head")));
  head.add(light);
  const group = new Group();
  group.add(mesh);
  return { group, mesh, head, light };
}
