import { describe, expect, test } from "bun:test";
import {
  attenuation,
  createSpatialGain,
  JUKEBOX_FALLOFF,
  OCCLUSION,
  roomOcclusion,
  VOICE_FALLOFF,
} from "./spatial.ts";

describe("attenuation curve", () => {
  const f = JUKEBOX_FALLOFF;

  test("full level near the source, then inverse distance", () => {
    expect(attenuation(0, f)).toBe(1);
    expect(attenuation(f.refDistance, f)).toBe(1);
    expect(attenuation(f.refDistance * 2, f)).toBeCloseTo(0.5, 6);
    expect(attenuation(f.refDistance * 4, f)).toBeCloseTo(0.25, 6);
  });

  test("never rises with distance, and is silent from maxDistance on", () => {
    let last = 1;
    for (let d = 0; d <= f.maxDistance + 10; d += 0.5) {
      const g = attenuation(d, f);
      expect(g).toBeLessThanOrEqual(last + 1e-12);
      expect(g).toBeGreaterThanOrEqual(0);
      last = g;
    }
    expect(attenuation(f.maxDistance, f)).toBe(0);
    expect(attenuation(f.maxDistance - 0.01, f)).toBeLessThan(0.001);
  });

  test("the fade starts smoothly: no step at fadeStart", () => {
    const before = attenuation(f.fadeStart - 0.01, f);
    const after = attenuation(f.fadeStart + 0.01, f);
    expect(Math.abs(before - after)).toBeLessThan(0.001);
  });

  test("unreachable is silent; bad input never throws", () => {
    expect(attenuation(Number.POSITIVE_INFINITY, f)).toBe(0);
    expect(attenuation(Number.NaN, f)).toBe(0);
  });

  test("the lobby, the corridors and the rooms (the issue's three zones)", () => {
    // Across the lobby (~20 m walked, same room): clearly audible.
    expect(attenuation(20, f) * roomOcclusion("lobby", "lobby")).toBeGreaterThan(0.25);
    // Out in a corridor (~25 m): faint.
    const corridor = attenuation(25, f) * roomOcclusion("lobby", null);
    expect(corridor).toBeGreaterThan(0.05);
    expect(corridor).toBeLessThan(0.15);
    // Deep in a project room (~55 m): silent.
    expect(attenuation(55, f) * roomOcclusion("lobby", "op-1")).toBe(0);
  });

  test("voice falls off much sooner than the jukebox (#48)", () => {
    expect(attenuation(10, VOICE_FALLOFF)).toBeLessThan(attenuation(10, JUKEBOX_FALLOFF));
    expect(attenuation(VOICE_FALLOFF.maxDistance, VOICE_FALLOFF)).toBe(0);
  });
});

describe("roomOcclusion", () => {
  test("same room full, corridor half, another room a fifth", () => {
    expect(roomOcclusion("lobby", "lobby")).toBe(1);
    expect(roomOcclusion(null, null)).toBe(1);
    expect(roomOcclusion("lobby", null)).toBe(OCCLUSION.corridor);
    expect(roomOcclusion("lobby", "op")).toBe(OCCLUSION.otherRoom);
  });
});

describe("createSpatialGain", () => {
  test("starts silent, glides to the clamped gain, skips repeats", () => {
    const calls: Array<[number, number, number]> = [];
    const node = {
      gain: {
        value: 1,
        setTargetAtTime: (v: number, t: number, c: number) => calls.push([v, t, c]),
      },
      connect: () => node,
      disconnect: () => undefined,
    };
    const ctx = { currentTime: 3, createGain: () => node as unknown as GainNode };
    const voice = createSpatialGain(ctx, {} as AudioNode);
    expect(node.gain.value).toBe(0);
    voice.set(0.5);
    voice.set(0.5);
    voice.set(7);
    voice.set(Number.NaN);
    expect(calls.map((c) => c[0])).toEqual([0.5, 1, 0]);
    expect(calls[0]?.[1]).toBe(3);
    expect(voice.gain).toBe(0);
  });
});
