/** The merge gong's client side (#43): where it hangs, its timing, its synth and its messages. */
import { describe, expect, test } from "bun:test";
import { FLOOR_TIERS, interactables, lobbyTemplate, templateForTier } from "@regulus/floor-layout";
import type { CommandRejected } from "@regulus/protocol";
import { create } from "zustand";
import { CONFETTI_CAPACITY, ConfettiField } from "../robots/confetti.ts";
import { GONG_INTERACT_RADIUS, gongAnchors, gongInReach } from "./gongAnchor.ts";

const BOARD_LIKE = new Set(["issue_board", "pr_board", "queue_clipboard"]);

import { useGongStore } from "./gongStore.ts";
import { bangGong, syncGong } from "./gongSync.ts";
import { type GongAudio, gongVoices, playGong } from "./gongSynth.ts";
import {
  CHEER_MS,
  cheerActive,
  cheerRemaining,
  GLOW_MS,
  GONG_CONFETTI,
  glowAt,
  gongBusy,
  lastStrikeAt,
  STRIKE_GAP_MS,
  SWING_MS,
  swingAngle,
  swingPeak,
} from "./timing.ts";

describe("gong anchor", () => {
  test.each([...FLOOR_TIERS])(
    "the %s room has one gong, reachable from its stand point",
    (tier) => {
      const [gong, ...rest] = gongAnchors(templateForTier(tier));
      expect(rest).toEqual([]);
      if (!gong) throw new Error("no gong");
      expect(gongInReach([gong], gong.stand)).toBe(gong);
      expect(gongInReach([gong], { x: gong.stand.x + 2, z: gong.stand.z })).toBeNull();
      // The confetti point is between the wall and the stand point.
      const toWall = Math.hypot(gong.front.x - gong.stand.x, gong.front.z - gong.stand.z);
      expect(toWall).toBeCloseTo(gong.anchor.approach - 0.3, 6);
    },
  );

  test.each([...FLOOR_TIERS])(
    "in the %s room no other E target reaches the gong's stand",
    (tier) => {
      const t = templateForTier(tier);
      const [gong] = gongAnchors(t);
      if (!gong) throw new Error("no gong");
      // Boards and the queue clipboard answer E within 1.4 m of their stand points.
      for (const a of interactables(t)) {
        if (a.id === gong.anchor.id || !BOARD_LIKE.has(a.kind)) continue;
        const d = Math.hypot(a.standAt.x - gong.stand.x, a.standAt.z - gong.stand.z);
        expect([a.id, d > 1.4 + GONG_INTERACT_RADIUS]).toEqual([a.id, true]);
      }
    },
  );

  test("a moved anchor moves the gong; the lobby has none", () => {
    const t = templateForTier("small");
    const moved = {
      ...t,
      wallAnchors: t.wallAnchors.map((a) => (a.kind === "gong" ? { ...a, t: a.t - 3 } : a)),
    };
    const [before] = gongAnchors(t);
    const [after] = gongAnchors(moved);
    const dx = (after?.stand.x ?? 0) - (before?.stand.x ?? 0);
    const dz = (after?.stand.z ?? 0) - (before?.stand.z ?? 0);
    expect(Math.hypot(dx, dz)).toBeCloseTo(3, 6);
    expect(gongAnchors(lobbyTemplate)).toEqual([]);
  });
});

describe("timing", () => {
  const ring = { at: 1000, strikes: 1 };
  const triple = { at: 1000, strikes: 3 };

  test("robots cheer for 3 s from the ring, not with reduced motion", () => {
    expect(cheerActive(ring, 999, false)).toBe(false);
    expect(cheerActive(ring, 1000, false)).toBe(true);
    expect(cheerActive(ring, 1000 + CHEER_MS - 1, false)).toBe(true);
    expect(cheerActive(ring, 1000 + CHEER_MS, false)).toBe(false);
    expect(cheerActive(ring, 1500, true)).toBe(false);
    expect(cheerActive(null, 1500, false)).toBe(false);
    expect(cheerRemaining(ring, 1500)).toBe(CHEER_MS - 500);
    expect(cheerRemaining(ring, 1000 + CHEER_MS)).toBeNull();
  });

  test("the disc swings after each strike and is exactly still afterwards", () => {
    let max = 0;
    for (let t = 1000; t < 1000 + SWING_MS; t += 16)
      max = Math.max(max, Math.abs(swingAngle(ring, t, false)));
    expect(max).toBeGreaterThan(0.1);
    expect(max).toBeLessThan(0.5);
    expect(swingAngle(ring, 1000 + SWING_MS, false)).toBe(0);
    expect(swingAngle(ring, 1300, true)).toBe(0);
    expect(swingAngle(null, 1300, false)).toBe(0);
    // The curve's own peak, whatever the frame rate that draws it.
    expect(swingPeak(ring, false)).toBeGreaterThanOrEqual(max);
    expect(swingPeak(ring, false)).toBeLessThan(max + 0.01);
    expect(swingPeak(ring, true)).toBe(0);
    expect(swingPeak(null, false)).toBe(0);
    // Three strikes: the last one lands two gaps later and the swing ends after it.
    expect(lastStrikeAt(triple)).toBe(1000 + 2 * STRIKE_GAP_MS);
    expect(swingAngle(triple, lastStrikeAt(triple) + 200, false)).not.toBe(0);
    expect(swingAngle(triple, lastStrikeAt(triple) + SWING_MS, false)).toBe(0);
  });

  test("the glow flashes at each strike and fades", () => {
    expect(glowAt(ring, 1000)).toBe(1);
    expect(glowAt(ring, 1000 + GLOW_MS / 2)).toBeCloseTo(0.5, 6);
    expect(glowAt(ring, 1000 + GLOW_MS)).toBe(0);
    expect(glowAt(triple, 1000 + STRIKE_GAP_MS)).toBe(1);
    expect(gongBusy(ring, 1000 + SWING_MS - 1)).toBe(true);
    expect(gongBusy(ring, 1000 + SWING_MS)).toBe(false);
  });
});

/** A Web Audio stand-in that records every node and its connections. */
function fakeAudio() {
  const nodes: { kind: string; connected: number; disconnected: boolean; stopAt?: number }[] = [];
  const param = () => ({
    value: 0,
    setValueAtTime() {},
    exponentialRampToValueAtTime() {},
  });
  const node = (kind: string) => {
    const rec = { kind, connected: 0, disconnected: false } as (typeof nodes)[number];
    nodes.push(rec);
    const n: Record<string, unknown> = {
      frequency: param(),
      gain: param(),
      Q: param(),
      type: "",
      buffer: null,
      onended: null as null | (() => void),
      connect(next: unknown) {
        rec.connected += 1;
        return next;
      },
      disconnect() {
        rec.disconnected = true;
      },
      start() {},
      stop(at: number) {
        rec.stopAt = at;
      },
    };
    return n;
  };
  const sources: Record<string, unknown>[] = [];
  const ctx = {
    currentTime: 10,
    sampleRate: 8000,
    state: "running",
    destination: {},
    resume: async () => {},
    createOscillator: () => {
      const n = node("osc");
      sources.push(n);
      return n;
    },
    createGain: () => node("gain"),
    createBiquadFilter: () => node("filter"),
    createBufferSource: () => {
      const n = node("noise");
      sources.push(n);
      return n;
    },
    createBuffer: (_c: number, length: number) => ({
      getChannelData: () => new Float32Array(length),
    }),
  };
  /** Fire every source's `ended`, as the audio thread would. */
  const endAll = () => {
    for (const s of sources) (s.onended as (() => void) | null)?.();
  };
  return { ctx: ctx as unknown as GongAudio, nodes, endAll };
}

describe("confetti", () => {
  test("a ring's bursts are gone within 3 s, in a fixed pool", () => {
    const field = new ConfettiField(CONFETTI_CAPACITY, () => 0.5);
    // The gong's burst plus one over each of ten robots: more than the pool holds.
    field.burst({ x: 0, y: 2, z: 0 }, GONG_CONFETTI);
    for (let i = 0; i < 10; i++) field.burst({ x: i, y: 1.9, z: 0 }, 30);
    expect(field.particles).toHaveLength(CONFETTI_CAPACITY);
    let live = field.step(1 / 60);
    expect(live).toBeGreaterThan(0);
    for (let t = 1 / 60; t < 3; t += 1 / 60) live = field.step(1 / 60);
    expect(live).toBe(0);
    // At 3 fps (software GL in CI) it is still gone within 3 s of wall-clock time.
    field.burst({ x: 0, y: 2, z: 0 }, GONG_CONFETTI);
    for (let t = 0; t < 3; t += 1 / 3) live = field.step(1 / 3);
    expect(live).toBe(0);
  });
});

describe("synth", () => {
  test("muted or reduced motion: nothing is scheduled", () => {
    const a = fakeAudio();
    expect(playGong(1, { volume: 0, reducedMotion: false, audio: a.ctx })).toBe(0);
    expect(playGong(1, { volume: 0.8, reducedMotion: true, audio: a.ctx })).toBe(0);
    expect(a.nodes).toEqual([]);
    expect(gongVoices(3, 0)).toEqual([]);
  });

  test("each strike is a thump and inharmonic partials; a triple ring is three strikes", () => {
    const one = gongVoices(1, 1);
    const three = gongVoices(3, 1);
    expect(three).toHaveLength(one.length * 3);
    expect(new Set(three.map((v) => v.start))).toEqual(new Set([0, 0.9, 1.8]));
    const ratios = one.map((v) => v.hz / (one[0]?.hz ?? 1));
    // Not a harmonic series: no partial above the base is a whole multiple.
    expect(ratios.slice(1).some((r) => Math.abs(r - Math.round(r)) < 0.01)).toBe(false);
    // Quieter at a lower volume.
    expect(Math.max(...gongVoices(1, 0.5).map((v) => v.peak))).toBeCloseTo(
      Math.max(...one.map((v) => v.peak)) / 2,
      9,
    );
  });

  test("every node is released when its sound ends: repeated rings leave nothing behind", () => {
    const a = fakeAudio();
    const voices = playGong(3, { volume: 1, reducedMotion: false, audio: a.ctx });
    expect(voices).toBe(gongVoices(3, 1).length);
    expect(a.nodes.filter((n) => n.kind === "osc")).toHaveLength(voices);
    expect(a.nodes.filter((n) => n.kind === "noise")).toHaveLength(3);
    // Every oscillator stops within 6 s of its strike.
    for (const n of a.nodes.filter((x) => x.kind === "osc"))
      expect(n.stopAt ?? Infinity).toBeLessThan(10 + 1.8 + 6);
    a.endAll();
    expect(a.nodes.every((n) => n.disconnected)).toBe(true);
  });
});

describe("messages", () => {
  function setup() {
    const floor = create<{ floorId: string | null }>()(() => ({ floorId: "f1" }));
    const listeners = new Map<string, (payload: unknown) => void>();
    let rejected: ((n: CommandRejected) => void) | null = null;
    const client = {
      onFloorMessage(type: string, fn: (payload: unknown) => void) {
        listeners.set(type, fn);
        return () => listeners.delete(type);
      },
      onRejected(fn: (n: CommandRejected) => void) {
        rejected = fn;
        return () => {
          rejected = null;
        };
      },
    };
    const played: number[] = [];
    const toasts: { kind: string; title?: string; message: string }[] = [];
    useGongStore.setState({ ring: null, strikes: 0 });
    const off = syncGong({
      client,
      floor: floor as never,
      play: (n) => played.push(n),
      toast: (t) => toasts.push(t),
    });
    const send = (type: string, payload: unknown) => listeners.get(type)?.(payload);
    return { floor, send, played, toasts, off, reject: (n: CommandRejected) => rejected?.(n) };
  }
  const merged = { floorId: "f1", repoId: "r1", number: 8, title: "Oil", url: "", at: 1 };

  test("a merge rings once and toasts; a queue triple-rings; a bang just rings", () => {
    const s = setup();
    s.send("pr.merged", merged);
    expect(useGongStore.getState().ring).toMatchObject({ floorId: "f1", cause: "merge" });
    expect(s.toasts).toEqual([
      { kind: "success", title: "Pull request merged", message: "#8 Oil" },
    ]);
    s.send("gong.ring", { floorId: "f1", cause: "queue_empty", strikes: 3, at: 2 });
    s.send("gong.ring", { floorId: "f1", cause: "bang", strikes: 1, by: "Mia", at: 3 });
    expect(s.played).toEqual([1, 3, 1]);
    expect(useGongStore.getState().strikes).toBe(5);
    expect(s.toasts).toHaveLength(2);
    s.off();
  });

  test("malformed messages and other floors' messages are ignored", () => {
    const s = setup();
    s.send("pr.merged", { ...merged, number: -1 });
    s.send("pr.merged", { ...merged, floorId: "f2" });
    s.send("gong.ring", { floorId: "f1", cause: "party", strikes: 1, at: 1 });
    s.send("gong.ring", { floorId: "f1", cause: "bang", strikes: 9, at: 1 });
    expect(s.played).toEqual([]);
    expect(useGongStore.getState().ring).toBeNull();
    s.off();
  });

  test("changing floors forgets the ring; a refused bang says why", () => {
    const s = setup();
    s.send("pr.merged", merged);
    s.floor.setState({ floorId: "f2" });
    expect(useGongStore.getState().ring).toBeNull();
    s.reject({ type: "gong.bang", reason: "The gong is still ringing." });
    s.reject({ type: "agent.stop", reason: "nope" });
    expect(s.toasts.at(-1)).toEqual({ kind: "info", message: "The gong is still ringing." });
    expect(s.toasts).toHaveLength(2);
    s.off();
  });

  test("bangGong sends gong.bang, and survives not being on a floor", () => {
    const sent: string[] = [];
    expect(bangGong((type) => sent.push(type))).toBe(true);
    expect(sent).toEqual(["gong.bang"]);
    expect(
      bangGong(() => {
        throw new Error("not joined");
      }),
    ).toBe(false);
  });
});
