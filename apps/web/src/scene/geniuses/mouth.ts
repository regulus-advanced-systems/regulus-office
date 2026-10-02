/**
 * The talking mouth (#48): a dark opening over a genius's painted mouth,
 * on the head bone so it follows every clip, that opens and closes while
 * LiveKit says the human is speaking. Hidden when silent, so a quiet
 * genius looks exactly as before. One small mesh per avatar.
 */
import { type Bone, BoxGeometry, Mesh, MeshBasicMaterial } from "three";
import type { ArchetypeModel } from "./bodies/types.ts";
import { boneNodeName, restJoints } from "./rig.ts";

const geometry = new BoxGeometry(1, 1, 1);
const material = new MeshBasicMaterial({ color: "#3A1414", toneMapped: false });

/** Fully open, metres. */
export const MOUTH_OPEN_HEIGHT = 0.07;

/** How open the mouth is (0..1) at time `t` seconds for a speaking level 0..1. Pure. */
export function mouthOpening(level: number, t: number): number {
  if (!(level > 0)) return 0;
  // Two incommensurate waves: syllable-ish chatter rather than a metronome.
  const chatter = 0.5 + 0.3 * Math.sin(t * 17) + 0.2 * Math.sin(t * 29 + 1.3);
  const loud = Math.min(1, 0.35 + level * 1.6);
  return Math.max(0, Math.min(1, chatter * loud));
}

export interface TalkingMouth {
  readonly mesh: Mesh;
  /** 0 hides it; up to 1 fully open. */
  set(open: number): void;
  dispose(): void;
}

export function attachMouth(bones: readonly Bone[], model: ArchetypeModel): TalkingMouth | null {
  const head = bones.find((b) => b.name === boneNodeName("head"));
  if (!head) return null;
  const joint = restJoints(model.body).head;
  const h = model.head;
  const width = Math.max(0.06, h.hx * 0.45);
  const mesh = new Mesh(geometry, material);
  mesh.name = "genius-mouth";
  mesh.visible = false;
  // On the face, just under the painted mouth, in the head bone's frame.
  mesh.position.set(
    h.c[0] + 0.01 - joint[0],
    h.c[1] - h.hy * 0.52 - joint[1],
    h.c[2] + h.hz + 0.016 - joint[2],
  );
  mesh.scale.set(width, 0.001, 0.012);
  head.add(mesh);
  return {
    mesh,
    set(open) {
      const o = Math.max(0, Math.min(1, Number.isFinite(open) ? open : 0));
      mesh.visible = o > 0.02;
      mesh.scale.y = Math.max(0.001, o * MOUTH_OPEN_HEIGHT);
    },
    dispose() {
      head.remove(mesh);
    },
  };
}
