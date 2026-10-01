/**
 * Beach ambience (#188): surf and gulls, synthesised (no samples).
 *
 * - Surf: looping brown noise through a low-pass whose gain and cut-off
 *   swell with each wave (one every 5-9 s): the wash, a crest, the drag
 *   back. Waves may overlap a little; each restarts the swell.
 * - Gulls: now and then two or three calls, each a short triangle tone
 *   gliding up and down ("kee-ow") through a band-pass.
 *
 * `level` (0..1, the office volume already folded in) follows the player:
 * full on the beach, faint in the lobby (through the door, fainter still
 * when it is shut), nothing deeper in. At 0 for a few seconds every node is
 * stopped and released, so the compound pays nothing for a beach it cannot
 * hear. Scheduling looks a couple of seconds ahead on each `update`.
 */
import { type OutsideLayout, onBeach } from "../layout.ts";
import { noiseBuffer, type SynthAudio, wake } from "./synth.ts";

export const AMBIENCE_PEAK = 0.32;
const LOOKAHEAD_S = 2.5;
const IDLE_STOP_S = 3;

export interface Wave {
  start: number;
  /** Seconds to the crest. */
  rise: number;
  /** Seconds from the crest back to the wash. */
  fall: number;
  /** Crest loudness above the wash, 0..1. */
  crest: number;
}

export interface GullCall {
  start: number;
  /** Start, peak and end pitch, Hz. */
  hz: [number, number, number];
  dur: number;
}

/** A wave breaking at `t`, and when the next one may start (5-9 s apart). */
export function waveAt(t: number, random: () => number): { wave: Wave; next: number } {
  const wave = {
    start: t,
    rise: 1.4 + random() * 0.8,
    fall: 2.6 + random() * 1.4,
    crest: 0.6 + random() * 0.4,
  };
  return { wave, next: t + 5 + random() * 4 };
}

/** A cluster of gull calls starting at `t`, and when the next cluster may start. */
export function gullCluster(t: number, random: () => number): { calls: GullCall[]; next: number } {
  const n = 2 + Math.floor(random() * 2);
  const calls: GullCall[] = [];
  let at = t;
  for (let i = 0; i < n; i++) {
    const base = 1250 + random() * 450;
    calls.push({ start: at, hz: [base, base * 1.45, base * 0.8], dur: 0.28 + random() * 0.2 });
    at += 0.38 + random() * 0.3;
  }
  return { calls, next: at + 8 + random() * 12 };
}

/**
 * How loud the beach is for a player at `(x, z)`: 1 on the sand or the dock,
 * fading over 20 m toward the door; through the doorway only a little,
 * less when it is shut. 0 deep in the compound.
 */
export function ambienceLevel(
  layout: OutsideLayout,
  p: { x: number; z: number },
  doorOpen: boolean,
): number {
  if (p.z >= layout.edgeZ) return onBeach(layout, p.x, p.z) || p.z > layout.edgeZ + 2 ? 1 : 0.9;
  const dx = Math.max(0, Math.abs(p.x - layout.door.centre) - 4);
  const d = Math.hypot(dx, layout.edgeZ - p.z);
  const through = doorOpen ? 0.55 : 0.12;
  return Math.max(0, through * (1 - d / 22));
}

export interface Ambience {
  /** Follow `level` (0..1); schedules surf and gulls ahead while audible. */
  update(level: number): void;
  stop(): void;
  readonly running: boolean;
}

export function createAmbience(
  getAudio: () => SynthAudio | null,
  random: () => number = Math.random,
): Ambience {
  let ctx: SynthAudio | null = null;
  let master: GainNode | null = null;
  let wash: GainNode | null = null;
  let lp: BiquadFilterNode | null = null;
  let surf: AudioBufferSourceNode | null = null;
  let nextWaveAt = 0;
  let nextGullAt = 0;
  let silentSince = Number.POSITIVE_INFINITY;

  const stop = () => {
    try {
      surf?.stop();
    } catch {
      // Already stopped.
    }
    for (const n of [surf, lp, wash, master]) n?.disconnect();
    surf = null;
    lp = null;
    wash = null;
    master = null;
    silentSince = Number.POSITIVE_INFINITY;
  };

  const start = (c: SynthAudio) => {
    ctx = c;
    master = c.createGain();
    master.gain.value = 0;
    wash = c.createGain();
    wash.gain.value = 0.35;
    lp = c.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 520;
    surf = c.createBufferSource();
    surf.buffer = noiseBuffer(c, 4, true);
    surf.loop = true;
    surf.connect(lp).connect(wash).connect(master).connect(c.destination);
    surf.start();
    nextWaveAt = c.currentTime + 0.5;
    nextGullAt = c.currentTime + 2 + random() * 4;
  };

  const scheduleWave = (w: Wave) => {
    if (!wash || !lp) return;
    const peak = 0.35 + w.crest * 0.65;
    wash.gain.setValueAtTime(0.35, w.start);
    wash.gain.linearRampToValueAtTime(peak, w.start + w.rise);
    wash.gain.linearRampToValueAtTime(0.35, w.start + w.rise + w.fall);
    lp.frequency.setValueAtTime(520, w.start);
    lp.frequency.exponentialRampToValueAtTime(1500 + w.crest * 900, w.start + w.rise);
    lp.frequency.exponentialRampToValueAtTime(520, w.start + w.rise + w.fall);
  };

  const scheduleGull = (c: SynthAudio, call: GullCall) => {
    if (!master) return;
    const osc = c.createOscillator();
    osc.type = "triangle";
    const [a, b, e] = call.hz;
    osc.frequency.setValueAtTime(a, call.start);
    osc.frequency.exponentialRampToValueAtTime(b, call.start + call.dur * 0.3);
    osc.frequency.exponentialRampToValueAtTime(e, call.start + call.dur);
    const bp = c.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 1800;
    bp.Q.value = 2;
    const env = c.createGain();
    env.gain.setValueAtTime(0.0001, call.start);
    env.gain.exponentialRampToValueAtTime(0.28, call.start + 0.04);
    env.gain.exponentialRampToValueAtTime(0.0001, call.start + call.dur);
    osc.connect(bp).connect(env).connect(master);
    osc.onended = () => {
      for (const n of [osc, bp, env]) n.disconnect();
      osc.onended = null;
    };
    osc.start(call.start);
    osc.stop(call.start + call.dur + 0.05);
  };

  return {
    get running() {
      return surf !== null;
    },
    stop,
    update(level) {
      const audible = level > 0.001;
      if (!surf) {
        if (!audible) return;
        const c = getAudio();
        if (!c) return;
        try {
          wake(c);
          start(c);
        } catch {
          stop();
          return;
        }
      }
      const c = ctx;
      if (!c || !master) return;
      try {
        master.gain.setTargetAtTime(Math.min(1, level) * AMBIENCE_PEAK, c.currentTime, 0.4);
        if (!audible) {
          if (silentSince === Number.POSITIVE_INFINITY) silentSince = c.currentTime;
          if (c.currentTime - silentSince > IDLE_STOP_S) stop();
          return;
        }
        silentSince = Number.POSITIVE_INFINITY;
        const horizon = c.currentTime + LOOKAHEAD_S;
        while (nextWaveAt < horizon) {
          const { wave, next } = waveAt(Math.max(nextWaveAt, c.currentTime), random);
          scheduleWave(wave);
          nextWaveAt = next;
        }
        while (nextGullAt < horizon) {
          const cluster = gullCluster(Math.max(nextGullAt, c.currentTime), random);
          for (const call of cluster.calls) scheduleGull(c, call);
          nextGullAt = cluster.next;
        }
      } catch {
        stop();
      }
    },
  };
}
