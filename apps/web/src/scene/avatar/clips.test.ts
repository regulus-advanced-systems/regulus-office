import { describe, expect, test } from "bun:test";
import { AVATAR_ANIMATIONS } from "@regulus/protocol";
import {
  CLIP_CANDIDATES,
  clipTable,
  FALLBACK_CLIP,
  isFallbackClip,
  ROBOT_CLIP_NAMES,
  ROBOT_CLIPS,
  resolveClip,
} from "./clips.ts";

describe("clips", () => {
  test("every avatar animation has candidates and resolves against the shipped GLB", () => {
    for (const animation of AVATAR_ANIMATIONS) {
      expect(CLIP_CANDIDATES[animation].length).toBeGreaterThan(0);
      expect(ROBOT_CLIP_NAMES).toContain(resolveClip(animation));
    }
  });

  test("direct clips win over fallbacks", () => {
    expect(resolveClip("idle")).toBe(ROBOT_CLIPS.idle);
    expect(resolveClip("walk")).toBe(ROBOT_CLIPS.walking);
    expect(resolveClip("wave")).toBe(ROBOT_CLIPS.wave);
    expect(isFallbackClip("idle", resolveClip("idle"))).toBe(false);
  });

  test("clips missing from the Quaternius model fall back to the closest available", () => {
    expect(resolveClip("sit_type")).toBe(ROBOT_CLIPS.sitting);
    expect(resolveClip("sit_idle")).toBe(ROBOT_CLIPS.sitting);
    expect(resolveClip("celebrate")).toBe(ROBOT_CLIPS.dance);
    expect(resolveClip("facepalm")).toBe(ROBOT_CLIPS.no);
    expect(resolveClip("point")).toBe(ROBOT_CLIPS.thumbsUp);
    expect(resolveClip("read")).toBe(ROBOT_CLIPS.idle);
    expect(resolveClip("think")).toBe(ROBOT_CLIPS.idle);
    expect(isFallbackClip("sit_type", resolveClip("sit_type"))).toBe(true);
  });

  test("a re-export with dedicated clips is picked up without code changes", () => {
    const available = [...ROBOT_CLIP_NAMES, "RobotArmature|Robot_SitType"];
    expect(resolveClip("sit_type", available)).toBe("RobotArmature|Robot_SitType");
  });

  test("walk degrades to running, then to idle, then to whatever exists", () => {
    expect(resolveClip("walk", [ROBOT_CLIPS.running, ROBOT_CLIPS.idle])).toBe(ROBOT_CLIPS.running);
    expect(resolveClip("walk", [ROBOT_CLIPS.idle])).toBe(FALLBACK_CLIP);
    expect(resolveClip("walk", ["Other"])).toBe("Other");
    expect(resolveClip("walk", [])).toBe(FALLBACK_CLIP);
  });

  test("clipTable covers the whole enum", () => {
    const table = clipTable();
    expect(Object.keys(table).sort()).toEqual([...AVATAR_ANIMATIONS].sort());
    expect(table.sit_idle).toBe(ROBOT_CLIPS.sitting);
  });
});
