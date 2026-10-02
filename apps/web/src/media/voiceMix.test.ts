import { describe, expect, test } from "bun:test";
import { attenuation, OCCLUSION, VOICE_FALLOFF } from "../audio/spatial.ts";
import { planVoices, VOICE_HYSTERESIS_M, voiceGain } from "./voiceMix.ts";

const me = { x: 0, z: 0, roomId: "lobby" };
const at = (id: string, x: number, roomId: string | null = "lobby") => ({ id, x, z: 0, roomId });

describe("proximity voice (#48)", () => {
  test("full level at conversation distance, fading out, silent past the edge", () => {
    expect(voiceGain(me, at("a", 1))).toBe(1);
    expect(voiceGain(me, at("a", 6))).toBeCloseTo(attenuation(6, VOICE_FALLOFF));
    expect(voiceGain(me, at("a", 6))).toBeLessThan(0.5);
    expect(voiceGain(me, at("a", VOICE_FALLOFF.maxDistance))).toBe(0);
  });

  test("walls between us take most of it (the jukebox's room occlusion)", () => {
    expect(voiceGain(me, at("a", 3, "op-1"))).toBeCloseTo(
      attenuation(3, VOICE_FALLOFF) * OCCLUSION.otherRoom,
    );
    expect(voiceGain({ ...me, roomId: null }, at("a", 3))).toBeCloseTo(
      attenuation(3, VOICE_FALLOFF) * OCCLUSION.corridor,
    );
    // Either way round: the speaker in the corridor, the listener in the lobby.
    expect(voiceGain(me, at("a", 3, null))).toBeCloseTo(
      attenuation(3, VOICE_FALLOFF) * OCCLUSION.corridor,
    );
    expect(voiceGain({ ...me, roomId: null }, at("a", 3, null))).toBeCloseTo(
      attenuation(3, VOICE_FALLOFF),
    );
  });

  test("receives only the nearest audible voices, at most `max`", () => {
    const sources = [at("far", 40), at("c", 5), at("a", 1), at("b", 3), at("d", 9)];
    const plan = planVoices(me, sources, { max: 3 });
    expect([...plan.subscribe].sort()).toEqual(["a", "b", "c"]);
    expect(plan.gains.get("far")).toBe(0);
    expect(planVoices(me, sources, { max: 10 }).subscribe.has("far")).toBe(false);
  });

  test("a voice at the edge stays received a little longer (no flapping)", () => {
    const edge = at("e", VOICE_FALLOFF.maxDistance + 1);
    expect(planVoices(me, [edge]).subscribe.has("e")).toBe(false);
    expect(planVoices(me, [edge], { current: new Set(["e"]) }).subscribe.has("e")).toBe(true);
    const gone = at("e", VOICE_FALLOFF.maxDistance + VOICE_HYSTERESIS_M + 1);
    expect(planVoices(me, [gone], { current: new Set(["e"]) }).subscribe.has("e")).toBe(false);
  });
});
