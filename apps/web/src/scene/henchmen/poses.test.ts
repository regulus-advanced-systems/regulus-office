/**
 * The henchman posed by its clips through a mixer, the way HenchmanAvatar
 * plays them (#184): still when idle and waiting with the hand up (#159),
 * moving while typing, the raised hand above the helmet, and the merge-gong
 * cheer (#43, #202) dancing the arms and upper body in the chair and ending
 * in exactly the seated pose it started from.
 */
import { describe, expect, test } from "bun:test";
import { AnimationMixer, type Bone, Vector3 } from "three";
import { CROSSFADE_SECONDS } from "../avatar/clips.ts";
import { ARM_OVERLAY_WEIGHT, HENCHMAN_CLIPS, henchmanClips } from "./clips.ts";
import { buildHenchman } from "./instance.ts";

type Snapshot = Map<string, { q: number[]; p: Vector3 }>;

function rig() {
  const h = buildHenchman("standard");
  const bones: Bone[] = [];
  h.group.traverse((o) => {
    if ((o as Bone).isBone) bones.push(o as Bone);
  });
  const mixer = new AnimationMixer(h.group);
  const action = (name: string) => {
    const clip = henchmanClips().find((c) => c.name === name);
    if (!clip) throw new Error(`no clip ${name}`);
    return mixer.clipAction(clip);
  };
  const snap = (): Snapshot =>
    new Map(bones.map((b) => [b.name, { q: b.quaternion.toArray(), p: b.position.clone() }]));
  const world = (name: string) => {
    h.group.updateMatrixWorld(true);
    return bones.find((b) => b.name === name)?.getWorldPosition(new Vector3()) ?? new Vector3();
  };
  return { h, bones, mixer, action, snap, world };
}

/** Angle between two rotations, radians (exactly 0 when equal; no acos rounding). */
function turned(a: Snapshot, b: Snapshot, bone: string): number {
  const x = a.get(bone)?.q ?? [0, 0, 0, 1];
  const y = b.get(bone)?.q ?? [0, 0, 0, 1];
  const sign = x.reduce((s, v, i) => s + v * (y[i] ?? 0), 0) < 0 ? -1 : 1;
  const diff = Math.hypot(...x.map((v, i) => v - sign * (y[i] ?? 0)));
  const sum = Math.hypot(...x.map((v, i) => v + sign * (y[i] ?? 0)));
  return 4 * Math.atan2(diff, sum);
}

const maxTurn = (a: Snapshot, b: Snapshot, bones: readonly string[]) =>
  Math.max(0, ...bones.map((n) => turned(a, b, n)));

/** The bones the e2e probe (tests/e2e/boneProbes.ts) reads. */
const PROBED = ["Head", "Body", "UpperArmL", "LowerArmL", "UpperArmR", "LowerArmR", "UpperLegL"];
const DEG = Math.PI / 180;

describe("henchman poses (#184)", () => {
  test("the probed bones exist", () => {
    const names = rig().bones.map((b) => b.name);
    for (const n of PROBED) expect(names).toContain(n);
  });

  test("sitting still: no bone moves (#159)", () => {
    const r = rig();
    r.action(HENCHMAN_CLIPS.sitIdle).play();
    r.mixer.update(0.5);
    const a = r.snap();
    for (let i = 0; i < 60; i++) r.mixer.update(1 / 30);
    expect(maxTurn(a, r.snap(), PROBED)).toBe(0);
  });

  test("typing moves the arms and head well past the probe's 3°", () => {
    const r = rig();
    r.action(HENCHMAN_CLIPS.sitType).play();
    r.mixer.update(0.01);
    const a = r.snap();
    let moved = 0;
    for (let i = 0; i < 36; i++) {
      r.mixer.update(1 / 30);
      moved = Math.max(moved, maxTurn(a, r.snap(), PROBED));
    }
    expect(moved).toBeGreaterThan(5 * DEG);
  });

  test("the raised hand goes up above the helmet and then holds still", () => {
    const r = rig();
    r.action(HENCHMAN_CLIPS.sitIdle).play();
    const hand = r.action(HENCHMAN_CLIPS.hand);
    hand.weight = ARM_OVERLAY_WEIGHT;
    hand.reset().fadeIn(CROSSFADE_SECONDS).play();
    for (let i = 0; i < 20; i++) r.mixer.update(1 / 30);
    expect(r.world("HandR").y).toBeGreaterThan(r.world("Head").y + 0.2);
    expect(r.world("HandL").y).toBeLessThan(r.world("Head").y);
    const a = r.snap();
    for (let i = 0; i < 60; i++) r.mixer.update(1 / 30);
    expect(maxTurn(a, r.snap(), PROBED)).toBe(0);
  });

  test("the seated cheer dances the arms and upper body, never the legs, and ends exactly seated", () => {
    const r = rig();
    const idle = r.action(HENCHMAN_CLIPS.sitIdle);
    const cheer = r.action(HENCHMAN_CLIPS.sitCheer);
    expect(cheer.getClip().duration).toBeGreaterThan(2.5);
    expect(cheer.getClip().duration).toBeLessThan(4);
    idle.play();
    r.mixer.update(0.5);
    const seated = r.snap();

    cheer.reset().fadeIn(CROSSFADE_SECONDS).play();
    idle.fadeOut(CROSSFADE_SECONDS);
    const legs = ["Hips", "UpperLegL", "UpperLegR", "LowerLegL", "LowerLegR", "FootL", "FootR"];
    let arms = 0;
    let legsMoved = 0;
    let hipsMoved = 0;
    for (let t = 0; t < 3; t += 1 / 30) {
      r.mixer.update(1 / 30);
      const now = r.snap();
      arms = Math.max(arms, turned(seated, now, "UpperArmL"), turned(seated, now, "UpperArmR"));
      legsMoved = Math.max(legsMoved, maxTurn(seated, now, legs));
      hipsMoved = Math.max(
        hipsMoved,
        now.get("Hips")?.p.distanceTo(seated.get("Hips")?.p ?? new Vector3()) ?? 1,
      );
    }
    // The e2e (7e) wants more than 10° of drift while it rings.
    expect(arms).toBeGreaterThan(60 * DEG);
    expect(legsMoved).toBeLessThan(1e-6);
    expect(hipsMoved).toBeLessThan(1e-6);

    idle.reset().fadeIn(CROSSFADE_SECONDS).play();
    cheer.fadeOut(CROSSFADE_SECONDS);
    for (let t = 0; t < 1; t += 1 / 30) r.mixer.update(1 / 30);
    const after = r.snap();
    for (const b of r.bones) {
      expect([b.name, turned(seated, after, b.name) < 1e-6]).toEqual([b.name, true]);
      const moved = seated.get(b.name)?.p.distanceTo(after.get(b.name)?.p ?? new Vector3()) ?? 1;
      expect([b.name, moved < 1e-6]).toEqual([b.name, true]);
    }
    r.mixer.update(2);
    expect(
      maxTurn(
        after,
        r.snap(),
        r.bones.map((b) => b.name),
      ),
    ).toBeLessThan(1e-6);
  });

  test("seated, the hands reach the desk height and the feet the floor", () => {
    const r = rig();
    r.action(HENCHMAN_CLIPS.sitType).play();
    r.mixer.update(0.01);
    // Desk tops are 0.76 m; the laptop's keys a little above. Origin = floor here.
    for (const hand of ["HandL", "HandR"]) {
      expect(r.world(hand).y).toBeGreaterThan(0.7);
      expect(r.world(hand).y).toBeLessThan(0.9);
      expect(r.world(hand).z).toBeGreaterThan(0.35);
    }
    expect(r.world("FootL").y).toBeLessThan(0.14);
  });
});
