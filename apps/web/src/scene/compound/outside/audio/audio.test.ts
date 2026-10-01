import { describe, expect, test } from "bun:test";
import { rowPlacement, testWorld } from "../../testing.ts";
import { dockPoint, outsideLayout } from "../layout.ts";
import { ambienceLevel, createAmbience, gullCluster, waveAt } from "./ambience.ts";
import { KLAXON_PERIOD_S, klaxonWhoops, playDoorMachinery, playKlaxon } from "./klaxon.ts";
import { doorLoudness, type SynthAudio } from "./synth.ts";

/** A Web Audio stand-in that records every node, its connections and its end. */
function fakeAudio() {
  const nodes: { kind: string; disconnected: boolean; stopped: boolean }[] = [];
  const sources: Record<string, unknown>[] = [];
  const param = () => ({
    value: 0,
    setValueAtTime() {},
    linearRampToValueAtTime() {},
    exponentialRampToValueAtTime() {},
    setTargetAtTime() {},
  });
  const node = (kind: string, source = false) => {
    const rec = { kind, disconnected: false, stopped: false };
    nodes.push(rec);
    const n: Record<string, unknown> = {
      frequency: param(),
      gain: param(),
      Q: param(),
      type: "",
      buffer: null,
      loop: false,
      onended: null as null | (() => void),
      connect: (next: unknown) => next,
      disconnect() {
        rec.disconnected = true;
      },
      start() {},
      stop() {
        rec.stopped = true;
      },
    };
    if (source) sources.push(n);
    return n;
  };
  const ctx = {
    currentTime: 10,
    sampleRate: 8000,
    state: "running",
    destination: {},
    resume: async () => {},
    createOscillator: () => node("osc", true),
    createGain: () => node("gain"),
    createBiquadFilter: () => node("filter"),
    createBufferSource: () => node("noise", true),
    createBuffer: (_c: number, length: number) => ({
      getChannelData: () => new Float32Array(length),
    }),
  };
  const endAll = () => {
    for (const s of sources) (s.onended as (() => void) | null)?.();
  };
  return { ctx: ctx as unknown as SynthAudio & { currentTime: number }, nodes, endAll };
}

describe("the klaxon and the door's machinery", () => {
  test("whoops repeat on a fixed period and rise", () => {
    const w = klaxonWhoops(3);
    expect(w.map((x) => x.start)).toEqual([0, KLAXON_PERIOD_S, 2 * KLAXON_PERIOD_S]);
    for (const x of w) expect(x.to).toBeGreaterThan(x.from);
  });

  test("muted: nothing at all is scheduled", () => {
    const a = fakeAudio();
    expect(playKlaxon(3, { volume: 0, loudness: 1 }, a.ctx)).toBe(0);
    expect(playDoorMachinery(4, true, { volume: 0, loudness: 1 }, a.ctx)).toBe(false);
    expect(a.nodes).toEqual([]);
    expect(playKlaxon(3, { volume: 1, loudness: 1 }, null)).toBe(0);
  });

  test("a klaxon is two voices a whoop, and every node is released when it ends", () => {
    const a = fakeAudio();
    expect(playKlaxon(3, { volume: 0.8, loudness: 1 }, a.ctx)).toBe(6);
    expect(playDoorMachinery(4, true, { volume: 0.8, loudness: 0.5 }, a.ctx)).toBe(true);
    a.endAll();
    expect(a.nodes.length).toBeGreaterThan(10);
    expect(a.nodes.every((n) => n.disconnected)).toBe(true);
  });

  test("louder near the door, faint (never silent) across the compound", () => {
    expect(doorLoudness(5)).toBe(1);
    expect(doorLoudness(40)).toBeLessThan(1);
    expect(doorLoudness(400)).toBeGreaterThan(0);
  });
});

describe("surf and gulls", () => {
  const layout = outsideLayout(testWorld([{ id: "a", placement: rowPlacement(4) }]));
  if (!layout) throw new Error("no outside");

  test("full on the beach and the dock; faint in the lobby, fainter with the door shut; nothing deep inside", () => {
    expect(ambienceLevel(layout, { x: layout.door.centre, z: layout.edgeZ + 4 }, false)).toBe(1);
    expect(ambienceLevel(layout, dockPoint(layout, 1), false)).toBe(1);
    const lobby = { x: layout.door.centre, z: layout.edgeZ - 4 };
    const open = ambienceLevel(layout, lobby, true);
    const shut = ambienceLevel(layout, lobby, false);
    expect(open).toBeGreaterThan(shut);
    expect(shut).toBeGreaterThan(0);
    expect(ambienceLevel(layout, { x: layout.door.centre, z: 10 }, true)).toBe(0);
  });

  test("waves every 5-9 s; gulls call in clusters of two or three", () => {
    const r = () => 0.5;
    const { wave, next } = waveAt(100, r);
    expect(wave.start).toBe(100);
    expect(next - 100).toBeGreaterThanOrEqual(5);
    expect(next - 100).toBeLessThanOrEqual(9);
    const g = gullCluster(50, r);
    expect(g.calls.length).toBeGreaterThanOrEqual(2);
    expect(g.calls.length).toBeLessThanOrEqual(3);
    expect(g.next).toBeGreaterThan(g.calls.at(-1)?.start ?? 0);
  });

  test("starts when audible, schedules ahead, and stops (releasing everything) once silent", () => {
    const a = fakeAudio();
    const amb = createAmbience(
      () => a.ctx,
      () => 0.5,
    );
    amb.update(0);
    expect(amb.running).toBe(false);
    expect(a.nodes).toEqual([]);
    amb.update(0.8);
    expect(amb.running).toBe(true);
    for (let i = 0; i < 20; i++) {
      a.ctx.currentTime += 0.5;
      amb.update(0.8);
    }
    expect(a.nodes.some((n) => n.kind === "osc")).toBe(true);
    // Muted (or walked deep inside): silent for a few seconds, then everything stops.
    for (let i = 0; i < 10; i++) {
      a.ctx.currentTime += 0.5;
      amb.update(0);
    }
    expect(amb.running).toBe(false);
    a.endAll();
    expect(a.nodes.every((n) => n.disconnected)).toBe(true);
  });
});
