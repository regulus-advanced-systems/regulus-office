/** The henchman's clips (#184): which clip plays when, and that every clip is well-formed. */
import { describe, expect, test } from "bun:test";
import { AVATAR_ANIMATIONS, type AvatarAnimation } from "@regulus/protocol";
import { HENCHMAN_CLIPS, henchmanClip, henchmanClips } from "./clips.ts";
import { BONE_NAMES } from "./rig.ts";

const clips = henchmanClips();
const byName = new Map(clips.map((c) => [c.name, c]));
const GESTURES = new Set<string>([
  HENCHMAN_CLIPS.hand,
  HENCHMAN_CLIPS.needsYou,
  HENCHMAN_CLIPS.needsYouStill,
]);
const PARTIAL = new Set<string>([HENCHMAN_CLIPS.carry, HENCHMAN_CLIPS.hold, ...GESTURES]);

/** Largest change of any track value over the clip. */
function motionOf(name: string): number {
  let most = 0;
  for (const track of byName.get(name)?.tracks ?? []) {
    const size = track.getValueSize();
    for (let k = 0; k < track.times.length; k++)
      for (let c = 0; c < size; c++)
        most = Math.max(most, Math.abs((track.values[k * size + c] ?? 0) - (track.values[c] ?? 0)));
  }
  return most;
}

const tracksOf = (name: string) => (byName.get(name)?.tracks ?? []).map((t) => t.name).sort();

describe("animation selection", () => {
  test("standing, every SPEC §9.3 animation has its own clip", () => {
    const want: Record<AvatarAnimation, string> = {
      idle: HENCHMAN_CLIPS.idle,
      walk: HENCHMAN_CLIPS.walk,
      sit_type: HENCHMAN_CLIPS.sitType,
      sit_idle: HENCHMAN_CLIPS.sitIdle,
      read: HENCHMAN_CLIPS.read,
      think: HENCHMAN_CLIPS.think,
      celebrate: HENCHMAN_CLIPS.celebrate,
      facepalm: HENCHMAN_CLIPS.facepalm,
      wave: HENCHMAN_CLIPS.wave,
      point: HENCHMAN_CLIPS.point,
      thumbs_up: HENCHMAN_CLIPS.point,
      clap: HENCHMAN_CLIPS.celebrate,
      dance: HENCHMAN_CLIPS.celebrate,
    };
    for (const a of AVATAR_ANIMATIONS)
      expect<string[]>([a, henchmanClip(a, false)]).toEqual([a, want[a]]);
  });

  test("seated: typing types, reading and thinking stay in the chair, anything else sits still", () => {
    expect(henchmanClip("sit_type", true)).toBe(HENCHMAN_CLIPS.sitType);
    expect(henchmanClip("sit_idle", true)).toBe(HENCHMAN_CLIPS.sitIdle);
    expect(henchmanClip("read", true)).toBe(HENCHMAN_CLIPS.sitRead);
    expect(henchmanClip("think", true)).toBe(HENCHMAN_CLIPS.sitThink);
    for (const a of ["idle", "walk", "wave", "point"] as const)
      expect(henchmanClip(a, true)).toBe(HENCHMAN_CLIPS.sitIdle);
  });

  test("the merge gong cheer only while seated (#43)", () => {
    expect(henchmanClip("sit_idle", true, true)).toBe(HENCHMAN_CLIPS.sitCheer);
    expect(henchmanClip("sit_type", true, true)).toBe(HENCHMAN_CLIPS.sitCheer);
    expect(henchmanClip("celebrate", false, true)).toBe(HENCHMAN_CLIPS.celebrate);
  });

  test("every selectable clip exists", () => {
    for (const a of AVATAR_ANIMATIONS)
      for (const seated of [false, true])
        for (const cheer of [false, true])
          expect(byName.has(henchmanClip(a, seated, cheer))).toBe(true);
  });
});

describe("clip data", () => {
  test("every full clip moves every bone and the hips, so a crossfade never strands a bone", () => {
    const full = BONE_NAMES.map((b) => `${b}.quaternion`)
      .concat("Hips.position")
      .sort();
    for (const clip of clips) {
      if (PARTIAL.has(clip.name)) continue;
      expect([clip.name, clip.tracks.map((t) => t.name).sort()]).toEqual([clip.name, full]);
    }
  });

  test("the carry only touches the arms; a gesture the arms, the head and the waist, never the legs", () => {
    for (const n of tracksOf(HENCHMAN_CLIPS.carry))
      expect(n).toMatch(/^(UpperArm|LowerArm)[LR]\.quaternion$/);
    for (const name of GESTURES) {
      expect(tracksOf(name).length).toBeGreaterThan(0);
      for (const n of tracksOf(name))
        expect(n).toMatch(/^((UpperArm|LowerArm|Hand)[LR]|Head|Abdomen)\.quaternion$/);
    }
  });

  test("the held clipboard only takes the left arm and holds it still (#281)", () => {
    const hold = tracksOf(HENCHMAN_CLIPS.hold);
    expect(hold).toEqual(["HandL.quaternion", "LowerArmL.quaternion", "UpperArmL.quaternion"]);
    expect(motionOf(HENCHMAN_CLIPS.hold)).toBe(0);
    // The done hand is the right arm, so a secretary can raise it without letting go.
    for (const n of tracksOf(HENCHMAN_CLIPS.hand)) expect(hold).not.toContain(n);
  });

  test("done and needs-you are different gestures (#235)", () => {
    // Done: one arm, the right. Needs you: both.
    const hand = tracksOf(HENCHMAN_CLIPS.hand);
    expect(hand).toContain("UpperArmR.quaternion");
    expect(hand.some((n) => /Arm[L]\./.test(n))).toBe(false);
    const waving = tracksOf(HENCHMAN_CLIPS.needsYou);
    expect(waving).toContain("UpperArmL.quaternion");
    expect(waving).toContain("UpperArmR.quaternion");
    // The still version holds the same bones in the wave's own pose.
    expect(tracksOf(HENCHMAN_CLIPS.needsYouStill)).toEqual(waving);
  });

  test("the done hand and the reduced-motion arms do not move; the wave does", () => {
    expect(motionOf(HENCHMAN_CLIPS.hand)).toBe(0);
    expect(motionOf(HENCHMAN_CLIPS.needsYouStill)).toBe(0);
    expect(motionOf(HENCHMAN_CLIPS.needsYou)).toBeGreaterThan(0.1);
  });

  test("loops are seamless: the last key equals the first", () => {
    for (const clip of clips)
      for (const track of clip.tracks) {
        const size = track.getValueSize();
        const first = Array.from(track.values.slice(0, size));
        const last = Array.from(track.values.slice(-size));
        const gap = Math.max(...first.map((v, i) => Math.abs(v - (last[i] ?? 0))));
        expect([clip.name, track.name, gap < 1e-5]).toEqual([clip.name, track.name, true]);
      }
  });

  test("the still seated pose has no motion at all (#159)", () => {
    for (const name of [HENCHMAN_CLIPS.sitIdle, HENCHMAN_CLIPS.hand]) {
      const clip = byName.get(name);
      for (const track of clip?.tracks ?? []) {
        const size = track.getValueSize();
        const first = Array.from(track.values.slice(0, size));
        for (let k = 0; k < track.times.length; k++)
          expect(Array.from(track.values.slice(k * size, k * size + size))).toEqual(first);
      }
    }
  });
});
