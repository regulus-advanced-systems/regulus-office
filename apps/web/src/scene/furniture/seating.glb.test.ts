/**
 * #163 against the real GLBs: the seated robot (robot.glb in the still seated
 * pose of #159) placed on every kind of seat with the placement the scene
 * uses, checked against the chair model as the scene places it.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { type FloorTemplate, type Seat, TEMPLATES } from "@regulus/floor-layout";
import {
  AnimationMixer,
  Box3,
  DoubleSide,
  Group,
  type Material,
  type Mesh,
  type Object3D,
  Raycaster,
  Vector3,
} from "three";
import { type GLTF, GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";
import { findBone, MODEL_YAW, ROBOT_MODEL_URL } from "../avatar/avatarRig.ts";
import { ROBOT_CLIPS } from "../avatar/clips.ts";
import { MODEL_SCALE } from "../avatar/RobotAvatar.tsx";
import { SEATED_CLIPS, seatedClips } from "../avatar/seatedClips.ts";
import {
  SEATED_BACK_DEPTH,
  SEATED_HEAD_BOTTOM,
  SEATED_HIPS,
  SEATED_SIT_DROP,
} from "../avatar/seatedFit.ts";
import { robotPlacement } from "../robots/seatPlacement.ts";
import type { SitSpec } from "./catalog.ts";
import { CHAIR_MODEL, FURNITURE_MODELS } from "./catalog.ts";
import { boxSize, centreBottomOffset, fitToFootprint } from "./placement.ts";
import { seatModel, sitAnchor } from "./sitAnchor.ts";

function loadGlb(url: string): Promise<GLTF> {
  const bytes = readFileSync(fileURLToPath(url));
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return new Promise((resolve, reject) => new GLTFLoader().parse(buffer, "", resolve, reject));
}

const models = new Map<string, GLTF>();
for (const spec of [CHAIR_MODEL, FURNITURE_MODELS.couch, FURNITURE_MODELS.armchair])
  if (spec) models.set(spec.url, await loadGlb(spec.url));
const robot = await loadGlb(ROBOT_MODEL_URL);

/** robot.glb in the still seated pose, scaled and turned as `RobotAvatar` draws it. */
function seatedRobot(): Group {
  const sitting = robot.animations.find((c) => c.name === ROBOT_CLIPS.sitting);
  if (!sitting) throw new Error("robot.glb has no sitting clip");
  const idle = seatedClips(sitting, (b) => findBone(robot.scene, b)?.quaternion.toArray()).find(
    (c) => c.name === SEATED_CLIPS.idle,
  );
  if (!idle) throw new Error("no seated idle clip");
  const instance = cloneSkeleton(robot.scene);
  const mixer = new AnimationMixer(instance);
  mixer.clipAction(idle).play();
  mixer.update(0.01);
  const model = new Group();
  model.scale.setScalar(MODEL_SCALE);
  model.rotation.y = MODEL_YAW;
  model.add(instance);
  const outer = new Group();
  outer.add(model);
  return outer;
}

/** Rigid body meshes: torso, thighs, head, shoulders and upper arms (not the skinned hands). */
const BODY = /^(Torso_\d|Head_\d|LegL|LegR|ShoulderL_1|ShoulderR_1|ArmL|ArmR)$/;

const box = (object: Object3D) => new Box3().setFromObject(object, true);
const named = (root: Object3D, re: RegExp) => {
  const out: Mesh[] = [];
  root.traverse((o) => {
    if ((o as Mesh).isMesh && re.test(o.name)) out.push(o as Mesh);
  });
  return out;
};

describe("robot.glb seated pose (seatedFit.ts)", () => {
  const r = seatedRobot();
  r.updateMatrixWorld(true);
  const hips = findBone(r, "Hips")?.getWorldPosition(new Vector3());
  if (!hips) throw new Error("no Hips bone");
  const union = (re: RegExp) =>
    named(r, re).reduce((b, m) => b.union(box(m)), new Box3().makeEmpty());

  test("the Hips bone is where SEATED_HIPS says (the model faces -z here)", () => {
    expect(hips.y).toBeCloseTo(SEATED_HIPS.up, 2);
    expect(hips.z).toBeCloseTo(SEATED_HIPS.back, 2);
  });

  test("the body's underside, back and head are where seatedFit.ts says", () => {
    const body = union(/^(Torso_\d|LegL|LegR)$/);
    expect(hips.y - body.min.y).toBeCloseTo(SEATED_SIT_DROP, 2);
    expect(body.max.z - hips.z).toBeCloseTo(SEATED_BACK_DEPTH, 2);
    expect(union(/^Head_\d$/).min.y - hips.y).toBeCloseTo(SEATED_HEAD_BOTTOM, 2);
  });
});

/** Raw model surfaces by ray casts, as fractions of its bounds (what `SitSpec` records). */
function measure(root: Object3D, sitBand: [number, number]) {
  root.updateMatrixWorld(true);
  const b = box(root);
  const s = boxSize(b);
  const cx = (b.min.x + b.max.x) / 2;
  const ray = new Raycaster();
  const down = (z: number) => {
    ray.set(new Vector3(cx, b.max.y + 1, z), new Vector3(0, -1, 0));
    return ray.intersectObject(root, true)[0]?.point.y ?? Number.NaN;
  };
  const front = (y: number) => {
    ray.set(new Vector3(cx, y, b.max.z + 1), new Vector3(0, 0, -1));
    return ray.intersectObject(root, true)[0]?.point.z ?? Number.NaN;
  };
  const seatTop = down(b.min.z + s.d * 0.7) / s.h;
  let backFront = 0;
  for (let y = sitBand[0]; y <= sitBand[1]; y += 0.01)
    backFront = Math.max(backFront, (front(y * s.h) - b.min.z) / s.d);
  const backTop = down(b.min.z + s.d * 0.05) / s.h;
  // Armrests: the innermost hit straight out sideways from the middle, over the cushion.
  let armrestsInner: number | undefined;
  for (let up = 0.02; up <= 0.4; up += 0.02)
    for (let k = 0.3; k <= 0.95; k += 0.05) {
      ray.set(new Vector3(cx, (seatTop + up) * s.h, b.min.z + s.d * k), new Vector3(1, 0, 0));
      const x = ray.intersectObject(root, true)[0]?.point.x;
      if (x !== undefined) armrestsInner = Math.min(armrestsInner ?? 1, (x - cx) / (s.w / 2));
    }
  return { size: s, seatTop, backFront, backTop, armrestsInner };
}

describe("SitSpec data matches the GLBs", () => {
  const cases: Array<[string, SitSpec | undefined, string | undefined]> = [
    ["chairDesk", CHAIR_MODEL.sit, CHAIR_MODEL.url],
    ["loungeSofa", FURNITURE_MODELS.couch?.sit, FURNITURE_MODELS.couch?.url],
    ["loungeChair", FURNITURE_MODELS.armchair?.sit, FURNITURE_MODELS.armchair?.url],
  ];
  for (const [name, sit, url] of cases)
    test(name, () => {
      const gltf = url ? models.get(url) : undefined;
      if (!sit || !gltf) throw new Error(`${name}: no sit data or model`);
      // The backrest is searched from just above the cushion to its top.
      const m = measure(gltf.scene, [sit.seatTop + 0.05, 0.99]);
      expect(m.size.w).toBeCloseTo(sit.size.w, 3);
      expect(m.size.h).toBeCloseTo(sit.size.h, 3);
      expect(m.size.d).toBeCloseTo(sit.size.d, 3);
      expect(m.seatTop).toBeCloseTo(sit.seatTop, 2);
      expect(m.backFront).toBeCloseTo(sit.backFront, 2);
      expect(m.backTop).toBeCloseTo(sit.backTop, 2);
      if (sit.armrestsInner === undefined) expect(m.armrestsInner).toBeUndefined();
      else expect(m.armrestsInner).toBeCloseTo(sit.armrestsInner, 1);
    });
});

/** The seat's model placed as `GltfProp` does it. */
function placedChair(template: FloorTemplate, seat: Seat): Group {
  const model = seatModel(template, seat);
  const gltf = model && models.get(model.spec.url);
  if (!model || !gltf) throw new Error(`${template.id}/${seat.id}: no model`);
  const clone = gltf.scene.clone(true);
  const bounds = box(clone);
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

/**
 * Chair vertices inside the robot's rigid body parts: in the part's box
 * (shrunk by 5 mm) and inside its closed surface by ray parity. Reported as
 * part, then the point relative to the hips across / up / along the seat.
 */
function chairPointsInsideBody(chair: Object3D, robotRoot: Object3D, seat: Seat, hips: Vector3) {
  const out: Array<{ label: string; across: number; up: number; along: number }> = [];
  const v = new Vector3();
  const ray = new Raycaster();
  const fx = -Math.sin(seat.pose.heading);
  const fz = -Math.cos(seat.pose.heading);
  for (const part of named(robotRoot, BODY)) {
    const material = part.material as Material;
    material.side = DoubleSide;
    part.geometry.computeBoundingBox();
    // The part's own units are 1/100 of the armature's: shrink by 5 mm in metres.
    const shrink = 0.005 / part.getWorldScale(new Vector3()).x;
    const local = part.geometry.boundingBox?.clone().expandByScalar(-shrink);
    if (!local) continue;
    const toPart = part.matrixWorld.clone().invert();
    chair.traverse((o) => {
      const mesh = o as Mesh;
      const pos = mesh.isMesh ? mesh.geometry.attributes.position : undefined;
      if (!pos) return;
      for (let i = 0; i < pos.count; i++) {
        const world = new Vector3().fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
        if (!local.containsPoint(v.copy(world).applyMatrix4(toPart))) continue;
        ray.set(world, new Vector3(0.31, 0.83, 0.47).normalize());
        if (ray.intersectObject(part, false).length % 2 === 0) continue;
        const d = world.clone().sub(hips);
        const across = d.x * -fz + d.z * fx;
        const along = d.x * fx + d.z * fz;
        const label = `${part.name} ${[across, d.y, along].map((n) => n.toFixed(3)).join("/")}`;
        out.push({ label, across, up: d.y, along });
      }
    });
  }
  return out;
}

/** The scale `fitToFootprint` gives a seat's model across (its own x axis). */
function placedScale(model: NonNullable<ReturnType<typeof seatModel>>): number {
  const sit = model.spec.sit;
  if (!sit) return 1;
  const p = fitToFootprint(sit.size, model.rect, model.heading, {
    targetHeight: model.spec.targetHeight,
    uniform: model.spec.uniform,
    modelHeading: model.spec.modelHeading,
  });
  return p.scale[0];
}

/** One seat of every seat kind / furniture kind pair in the templates. */
function seatKinds(): Array<[string, FloorTemplate, Seat]> {
  const seen = new Map<string, [string, FloorTemplate, Seat]>();
  for (const t of TEMPLATES.values())
    for (const seat of t.seats) {
      const piece = t.obstacles.find((o) => o.id === seat.furnitureId);
      const key = `${seat.kind} at ${piece?.kind ?? "nothing"}`;
      if (!seen.has(key)) seen.set(key, [key, t, seat]);
    }
  return [...seen.values()];
}

describe("the seated robot on every kind of seat (#163)", () => {
  const kinds = seatKinds();
  test("covers desk, meeting, bistro, reception, armchair and couch seats", () => {
    expect(kinds.map(([k]) => k).sort()).toEqual([
      "chair at bistro_table",
      "chair at meeting_table",
      "couch at armchair",
      "couch at couch",
      "desk at ceo_desk",
      "desk at desk",
      "desk at shared_table",
      "reception at reception_desk",
    ]);
  });

  for (const [kind, template, seat] of kinds)
    test(kind, () => {
      const chair = placedChair(template, seat);
      const r = seatedRobot();
      const place = robotPlacement(seat, true, sitAnchor(template, seat));
      r.position.set(...place.position);
      r.rotation.y = place.rotationY;
      const scene = new Group();
      scene.add(chair, r);
      scene.updateMatrixWorld(true);
      const hips = findBone(r, "Hips")?.getWorldPosition(new Vector3());
      if (!hips) throw new Error("no Hips bone");
      const ray = new Raycaster();

      // The hip bone is over the cushion, within 3 cm of its top.
      ray.set(new Vector3(hips.x, hips.y + 0.001, hips.z), new Vector3(0, -1, 0));
      const cushion = ray.intersectObject(chair, true)[0]?.point.y;
      expect(cushion).toBeDefined();
      expect(Math.abs(hips.y - (cushion ?? 0))).toBeLessThanOrEqual(0.03);

      // In front of the backrest: straight back from the hips, the chair is further than the robot's back.
      const back = new Vector3(Math.sin(seat.pose.heading), 0, Math.cos(seat.pose.heading));
      for (let dy = 0.05; dy <= 0.5; dy += 0.05) {
        ray.set(new Vector3(hips.x, hips.y + dy, hips.z), back);
        const hit = ray.intersectObject(chair, true)[0]?.distance ?? Number.POSITIVE_INFINITY;
        expect(hit).toBeGreaterThan(SEATED_BACK_DEPTH);
      }

      // Bounding-box check, refined: a chair vertex inside a body part's box must also be
      // outside the part's actual surface (ray parity), so nothing of the chair shows through.
      const model = seatModel(template, seat);
      const sit = model?.spec.sit;
      if (!model || !sit) throw new Error("no sit data");
      const halfWidth = (sit.size.w / 2) * placedScale(model);
      // The armrests may pass into the pelvis (it is wider than they are apart); the seat
      // and the backrest may not.
      const anchor = sitAnchor(template, seat);
      const hipsAlong =
        (hips.x - seat.pose.x) * -Math.sin(seat.pose.heading) +
        (hips.z - seat.pose.z) * -Math.cos(seat.pose.heading);
      const armrest = (p: { across: number; up: number; along: number }) =>
        sit.armrestsInner !== undefined &&
        Math.abs(p.across) >= sit.armrestsInner * halfWidth - 0.005 &&
        p.up > (cushion ?? 0) - hips.y &&
        p.along > anchor.backFwd - hipsAlong;
      const inside = chairPointsInsideBody(chair, r, seat, hips).filter((p) => !armrest(p));
      expect(inside.map((p) => p.label)).toEqual([]);

      // No body part sinks into the seat: the underside of the torso and thighs is on or above it.
      const body = named(r, /^(Torso_\d|LegL|LegR)$/).reduce(
        (b, m) => b.union(box(m)),
        new Box3().makeEmpty(),
      );
      expect(body.min.y).toBeGreaterThanOrEqual((cushion ?? 0) - 0.005);
    });
});
