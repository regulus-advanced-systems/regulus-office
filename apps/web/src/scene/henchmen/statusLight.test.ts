/**
 * The shoulder status light (#281): without a hat to carry it, the light must
 * still show from the room camera, which looks down from 50° (30° up close)
 * and can be turned to any side, whatever the henchman is doing in its chair.
 */
import { describe, expect, test } from "bun:test";
import { CHARACTER_FORM_IDS } from "@regulus/protocol";
import { AnimationMixer, type Intersection, Raycaster, SkinnedMesh, Vector3 } from "three";
import { CLOSE_PITCH_DEG, ORBIT_PITCH_DEG } from "../camera/orbit.ts";
import {
  ARM_OVERLAY_WEIGHT,
  HENCHMAN_CLIPS,
  type HenchmanClipName,
  henchmanClips,
} from "./clips.ts";
import { buildHenchman } from "./instance.ts";
import { buildOf, lightAt } from "./skins.ts";
import { LIGHT_BARS, LIGHT_RADIUS, lightAreaFromAbove, lightGeometry } from "./statusLight.ts";

const DEG = Math.PI / 180;

function posed(skin: string, base: HenchmanClipName, overlay?: HenchmanClipName, at = 0.3) {
  const h = buildHenchman(skin);
  const mixer = new AnimationMixer(h.group);
  const clip = (name: string) => {
    const c = henchmanClips().find((x) => x.name === name);
    if (!c) throw new Error(name);
    return c;
  };
  mixer.clipAction(clip(base)).play();
  if (overlay) {
    const a = mixer.clipAction(clip(overlay));
    a.weight = ARM_OVERLAY_WEIGHT;
    a.play();
  }
  mixer.update(at);
  h.group.updateMatrixWorld(true);
  return h;
}

/** The two bars' centres in world space. */
function bars(h: ReturnType<typeof buildHenchman>, skin: string): Vector3[] {
  const x = LIGHT_BARS[buildOf(skin)].at[0];
  return [x, -x].map((dx) => h.light.localToWorld(new Vector3(dx, 0, 0)));
}

/** Is the top of a bar in plain sight from a camera at `yaw`, looking down at `pitch`? */
function seen(h: ReturnType<typeof buildHenchman>, bar: Vector3, yawDeg: number, pitchDeg: number) {
  const toCamera = new Vector3(
    Math.cos(pitchDeg * DEG) * Math.sin(yawDeg * DEG),
    Math.sin(pitchDeg * DEG),
    Math.cos(pitchDeg * DEG) * Math.cos(yawDeg * DEG),
  );
  // From the bar's surface on the camera's side, towards the camera: nothing of the body in the way.
  const from = bar.clone().addScaledVector(toCamera, LIGHT_RADIUS + 0.005);
  const hits: Intersection[] = [];
  SkinnedMesh.prototype.raycast.call(h.mesh, new Raycaster(from, toCamera, 0, 3), hits);
  return hits.length === 0;
}

const YAWS = [0, 45, 90, 135, 180, 225, 270, 315];
/** Seated poses with the arms down: base clip and overlay. */
const ARMS_DOWN: Array<[string, HenchmanClipName, HenchmanClipName?]> = [
  ["sitting still", HENCHMAN_CLIPS.sitIdle],
  ["typing", HENCHMAN_CLIPS.sitType],
  ["reading", HENCHMAN_CLIPS.sitRead],
  ["thinking", HENCHMAN_CLIPS.sitThink],
];
/** Seated poses with an arm raised beside a bar (the gesture itself says "look at me"). */
const ARMS_UP: Array<[string, HenchmanClipName, HenchmanClipName?]> = [
  ["done, a hand up", HENCHMAN_CLIPS.sitIdle, HENCHMAN_CLIPS.hand],
  ["waiting, both arms up", HENCHMAN_CLIPS.sitIdle, HENCHMAN_CLIPS.needsYouStill],
  ["waiting, waving", HENCHMAN_CLIPS.sitIdle, HENCHMAN_CLIPS.needsYou],
  ["cheering", HENCHMAN_CLIPS.sitCheer],
];

describe("the shoulder status light", () => {
  test("two bars on the shoulders, clear of the collar and inside the shoulder line", () => {
    for (const id of CHARACTER_FORM_IDS) {
      const build = buildOf(id);
      const { at, half } = LIGHT_BARS[build];
      const h = buildHenchman(id);
      h.group.updateMatrixWorld(true);
      const [left, right] = bars(h, id) as [Vector3, Vector3];
      expect(left.x).toBeCloseTo(at[0], 5);
      expect(right.x).toBeCloseTo(-at[0], 5);
      expect(left.y).toBeCloseTo(lightAt(id)[1], 5);
      // Below the chin, above the armpits; beside the neck, not past the arm.
      expect(left.y).toBeGreaterThan(1.38);
      expect(left.y).toBeLessThan(1.47);
      expect(at[0] - half).toBeGreaterThan(0.07);
      expect(at[0] + half + LIGHT_RADIUS).toBeLessThan(0.27);
      expect(lightGeometry(build)).toBe(lightGeometry(build));
      expect(h.light.parent?.name).toBe("Body");
    }
  });

  test("it shows more light to the camera than the old hat lamp did", () => {
    // #184's lamp was a 4 cm sphere on the hat: a disc of pi * 0.04^2 from any side.
    const old = Math.PI * 0.04 ** 2;
    for (const build of ["crew", "secretary"] as const)
      expect(lightAreaFromAbove(build)).toBeGreaterThan(old * 2);
  });

  for (const id of CHARACTER_FORM_IDS)
    test(`${id}: seated with the arms down, a bar is in plain sight from every side of the room camera`, () => {
      const hidden: string[] = [];
      for (const [what, base, overlay] of ARMS_DOWN)
        for (const at of [0.3, 0.8, 1.6]) {
          const h = posed(id, base, overlay, at);
          const both = bars(h, id);
          for (const pitch of [ORBIT_PITCH_DEG, CLOSE_PITCH_DEG])
            for (const yaw of YAWS)
              if (!both.some((b) => seen(h, b, yaw, pitch)))
                hidden.push(`${what} at ${at}s, pitch ${pitch}, yaw ${yaw}`);
        }
      expect(hidden).toEqual([]);
    });

  test("with an arm raised, only a camera exactly side-on can lose the light behind the arm", () => {
    for (const id of ["standard", "secretary"])
      for (const [what, base, overlay] of ARMS_UP)
        for (const at of [0.3, 0.8, 1.6]) {
          const h = posed(id, base, overlay, at);
          const both = bars(h, id);
          for (const pitch of [ORBIT_PITCH_DEG, CLOSE_PITCH_DEG]) {
            const hidden = YAWS.filter((yaw) => !both.some((b) => seen(h, b, yaw, pitch)));
            expect([id, what, at, pitch, hidden.filter((y) => y !== 90 && y !== 270)]).toEqual([
              id,
              what,
              at,
              pitch,
              [],
            ]);
          }
        }
  });

  test("standing and walking, both bars show from the default pitch on most sides", () => {
    for (const base of [HENCHMAN_CLIPS.idle, HENCHMAN_CLIPS.walk]) {
      const h = posed("standard", base);
      const both = bars(h, "standard");
      for (const yaw of YAWS)
        expect(both.filter((b) => seen(h, b, yaw, ORBIT_PITCH_DEG)).length).toBeGreaterThanOrEqual(
          1,
        );
      expect(both.every((b) => seen(h, b, 0, ORBIT_PITCH_DEG))).toBe(true);
      expect(both.every((b) => seen(h, b, 180, ORBIT_PITCH_DEG))).toBe(true);
    }
  });
});
