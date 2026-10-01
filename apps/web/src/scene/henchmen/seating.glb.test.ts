/**
 * The seated henchman (#184) against the real chair GLBs, placed with the
 * scene's own code (henchmanPlacement + sitAnchor, #163): the measurements in
 * seatedFit.ts match the model, and on every kind of seat the hips rest on
 * the cushion, the back clears the backrest, the feet reach the floor, and
 * the body fits between backrest and table like the henchman's did.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { type RoomTemplate, type Seat, TEMPLATES } from "@regulus/room-layout";
import { AnimationMixer, Box3, Group, type Object3D, Raycaster, Vector3 } from "three";
import { type GLTF, GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MODEL_YAW } from "../avatar/avatarRig.ts";
import { SEATED_REACH } from "../avatar/seatedFit.ts";
import { CHAIR_MODEL, FURNITURE_MODELS } from "../furniture/catalog.ts";
import { boxSize, centreBottomOffset, fitToFootprint } from "../furniture/placement.ts";
import { seatModel, sitAnchor } from "../furniture/sitAnchor.ts";
import { henchmanPlacement } from "../henchmen/seatPlacement.ts";
import { HENCHMAN_CLIPS, henchmanClips } from "./clips.ts";
import { buildHenchman } from "./instance.ts";
import { BONE_INDEX } from "./rig.ts";
import { HENCHMAN_SEATED_BODY, HENCHMAN_SEATED_FRONT } from "./seatedFit.ts";

function loadGlb(url: string): Promise<GLTF> {
  const bytes = readFileSync(fileURLToPath(url));
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return new Promise((resolve, reject) => new GLTFLoader().parse(buffer, "", resolve, reject));
}

const models = new Map<string, GLTF>();
for (const spec of [CHAIR_MODEL, FURNITURE_MODELS.couch, FURNITURE_MODELS.armchair])
  if (spec) models.set(spec.url, await loadGlb(spec.url));

/** The henchman in the still seated pose, turned as HenchmanAvatar draws it. */
function seatedHenchman() {
  const h = buildHenchman("standard");
  const clip = henchmanClips().find((c) => c.name === HENCHMAN_CLIPS.sitIdle);
  if (!clip) throw new Error("no seated clip");
  const mixer = new AnimationMixer(h.group);
  mixer.clipAction(clip).play();
  mixer.update(0.01);
  const model = new Group();
  model.rotation.y = MODEL_YAW;
  model.add(h.group);
  const outer = new Group();
  outer.add(model);
  return { outer, mesh: h.mesh };
}

/** Posed vertices of the torso (Hips/Abdomen/Body) and thighs, in world space. */
function bodyPoints(mesh: ReturnType<typeof seatedHenchman>["mesh"]) {
  mesh.updateMatrixWorld(true);
  const torso = new Set([BONE_INDEX.Hips, BONE_INDEX.Abdomen, BONE_INDEX.Body]);
  const thighs = new Set([BONE_INDEX.UpperLegL, BONE_INDEX.UpperLegR]);
  const feet = new Set([BONE_INDEX.FootL, BONE_INDEX.FootR]);
  const out = { torso: [] as Vector3[], thighs: [] as Vector3[], feet: [] as Vector3[] };
  const pos = mesh.geometry.attributes.position;
  const index = mesh.geometry.attributes.skinIndex;
  const weight = mesh.geometry.attributes.skinWeight;
  if (!pos || !index || !weight) throw new Error("not skinned");
  for (let i = 0; i < pos.count; i++) {
    if (weight.getX(i) < 0.5) continue;
    const b = index.getX(i);
    const list = torso.has(b)
      ? out.torso
      : thighs.has(b)
        ? out.thighs
        : feet.has(b)
          ? out.feet
          : null;
    if (!list) continue;
    list.push(mesh.getVertexPosition(i, new Vector3()).applyMatrix4(mesh.matrixWorld));
  }
  return out;
}

describe("the henchman's seated pose (seatedFit.ts)", () => {
  const { outer, mesh } = seatedHenchman();
  outer.updateMatrixWorld(true);
  const pts = bodyPoints(mesh);
  const hipsY = HENCHMAN_SEATED_BODY.hips.up;
  // The model faces -z here (MODEL_YAW): "back" is +z.
  const lowTorso = pts.torso.filter((p) => p.y < hipsY + 0.45);

  test("the underside, back and front are where seatedFit.ts says", () => {
    // What rests on the cushion: the seat of the trousers, within 15 cm of the hips (the
    // thighs slope down towards the knees past the cushion's front edge).
    const seat = [...pts.torso, ...pts.thighs].filter((p) => Math.abs(p.z) < 0.15);
    const underside = Math.min(...seat.map((p) => p.y));
    expect(hipsY - underside).toBeCloseTo(HENCHMAN_SEATED_BODY.sitDrop, 2);
    expect(Math.max(...lowTorso.map((p) => p.z))).toBeCloseTo(HENCHMAN_SEATED_BODY.backDepth, 2);
    expect(-Math.min(...lowTorso.map((p) => p.z))).toBeCloseTo(HENCHMAN_SEATED_FRONT, 2);
  });

  test("it fits between backrest and table wherever the henchman did (chairSetBack)", () => {
    expect(0.02 + HENCHMAN_SEATED_BODY.backDepth + HENCHMAN_SEATED_FRONT).toBeLessThan(
      SEATED_REACH,
    );
  });

  test("the boots are on the floor (within 3 cm) when the hips are on a desk chair", () => {
    const lift = 0.315 + HENCHMAN_SEATED_BODY.sitDrop - hipsY;
    const sole = Math.min(...pts.feet.map((p) => p.y)) + lift;
    expect(Math.abs(sole)).toBeLessThan(0.03);
  });
});

function placedChair(template: RoomTemplate, seat: Seat): Group {
  const model = seatModel(template, seat);
  const gltf = model && models.get(model.spec.url);
  if (!model || !gltf) throw new Error(`${template.id}/${seat.id}: no model`);
  const clone = gltf.scene.clone(true);
  const bounds = new Box3().setFromObject(clone, true);
  const p = fitToFootprint(boxSize(bounds), model.rect, model.heading, {
    targetHeight: model.spec.targetHeight,
    uniform: model.spec.uniform,
    modelHeading: model.spec.modelHeading,
  });
  clone.position.set(...centreBottomOffset(bounds));
  const g = new Group();
  g.position.set(p.position[0], 0, p.position[2]);
  g.rotation.y = p.rotationY;
  g.scale.set(...p.scale);
  g.add(clone);
  return g;
}

function seatKinds(): Array<[string, RoomTemplate, Seat]> {
  const seen = new Map<string, [string, RoomTemplate, Seat]>();
  for (const t of TEMPLATES.values())
    for (const seat of t.seats) {
      const piece = t.obstacles.find((o) => o.id === seat.furnitureId);
      const key = `${seat.kind} at ${piece?.kind ?? "nothing"}`;
      if (!seen.has(key)) seen.set(key, [key, t, seat]);
    }
  return [...seen.values()];
}

describe("the seated henchman on every kind of seat", () => {
  for (const [kind, template, seat] of seatKinds())
    test(kind, () => {
      const chair = placedChair(template, seat);
      const h = seatedHenchman();
      const place = henchmanPlacement(seat, true, sitAnchor(template, seat), HENCHMAN_SEATED_BODY);
      h.outer.position.set(...place.position);
      h.outer.rotation.y = place.rotationY;
      const scene = new Group();
      scene.add(chair, h.outer);
      scene.updateMatrixWorld(true);
      const hips = new Vector3();
      h.mesh.skeleton.bones[BONE_INDEX.Hips]?.getWorldPosition(hips);
      const ray = new Raycaster();
      const hit = (from: Vector3, dir: Vector3, target: Object3D) => {
        ray.set(from, dir);
        return ray.intersectObject(target, true)[0];
      };

      // On the cushion: the underside of the body within 3 cm of its top.
      const cushion = hit(
        new Vector3(hips.x, hips.y + 0.001, hips.z),
        new Vector3(0, -1, 0),
        chair,
      );
      expect(cushion).toBeDefined();
      const underside = hips.y - HENCHMAN_SEATED_BODY.sitDrop;
      expect(Math.abs(underside - (cushion?.point.y ?? 0))).toBeLessThanOrEqual(0.03);

      // In front of the backrest: straight back from the hips, the chair is beyond the henchman's back.
      const back = new Vector3(Math.sin(seat.pose.heading), 0, Math.cos(seat.pose.heading));
      for (let dy = 0.05; dy <= 0.45; dy += 0.05) {
        const d = hit(new Vector3(hips.x, hips.y + dy, hips.z), back, chair)?.distance;
        expect(d ?? Number.POSITIVE_INFINITY).toBeGreaterThan(HENCHMAN_SEATED_BODY.backDepth);
      }
    });
});
