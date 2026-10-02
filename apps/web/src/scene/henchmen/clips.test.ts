/** The henchman's clips (#184): which clip plays when, and that every clip is well-formed. */
import { describe, expect, test } from "bun:test";
import { AVATAR_ANIMATIONS, type AvatarAnimation } from "@regulus/protocol";
import { HENCHMAN_CLIPS, henchmanClip, henchmanClips } from "./clips.ts";
import { BONE_NAMES } from "./rig.ts";

const clips = henchmanClips();
const byName = new Map(clips.map((c) => [c.name, c]));
const PARTIAL = new Set<string>([HENCHMAN_CLIPS.hand, HENCHMAN_CLIPS.carry]);

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

  test("the raised hand and the carry only touch the arms", () => {
    for (const name of PARTIAL) {
      const names = byName.get(name)?.tracks.map((t) => t.name) ?? [];
      expect(names.length).toBeGreaterThan(0);
      for (const n of names) expect(n).toMatch(/^(UpperArm|LowerArm|Hand)[LR]\.quaternion$/);
    }
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
