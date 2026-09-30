/**
 * The merge gong's sound (#43), synthesised with Web Audio: no samples, so
 * nothing copyrighted. Each strike is a soft mallet thump (a short band-passed
 * noise burst) plus inharmonic sine partials over a low G. The low partials
 * speak at once and ring for seconds; the upper ones bloom a moment later and
 * die sooner, which is what makes a gong shimmer rather than a bell ding.
 *
 * Silent at volume 0 (the mute) and with reduced motion, like the ding and
 * the footsteps (audio/ding.ts). Every node is disconnected when its
 * oscillator ends, so repeated rings leave nothing behind.
 */
import { STRIKE_GAP_MS } from "./timing.ts";

export const GONG_BASE_HZ = 98;

export interface GongPartial {
  /** Frequency as a multiple of the base. */
  ratio: number;
  /** Relative level, 0..1. */
  gain: number;
  /** Seconds to peak (the bloom of the upper partials). */
  attack: number;
  /** Seconds from the strike until it is inaudible. */
  decay: number;
}

export const GONG_PARTIALS: readonly GongPartial[] = [
  { ratio: 1, gain: 1, attack: 0.01, decay: 5.5 },
  { ratio: 1.52, gain: 0.7, attack: 0.02, decay: 4.5 },
  { ratio: 2.03, gain: 0.5, attack: 0.05, decay: 3.8 },
  { ratio: 2.58, gain: 0.42, attack: 0.12, decay: 3.2 },
  { ratio: 3.11, gain: 0.3, attack: 0.25, decay: 2.6 },
  { ratio: 3.87, gain: 0.22, attack: 0.35, decay: 2 },
  { ratio: 4.69, gain: 0.14, attack: 0.4, decay: 1.5 },
];
/** Peak level of the loudest partial at volume 1. */
export const GONG_PEAK = 0.16;
const STRIKE_GAP_S = STRIKE_GAP_MS / 1000;
const THUMP_SECONDS = 0.09;

export interface GongVoice {
  hz: number;
  /** Seconds after the first strike. */
  start: number;
  peak: number;
  attack: number;
  decay: number;
}

/** Every partial of every strike, as scheduled for `strikes` at `volume` 0..1. */
export function gongVoices(strikes: number, volume: number): GongVoice[] {
  if (!(volume > 0) || !(strikes > 0)) return [];
  const level = GONG_PEAK * Math.min(1, volume);
  const voices: GongVoice[] = [];
  for (let i = 0; i < strikes; i++) {
    for (const p of GONG_PARTIALS) {
      voices.push({
        hz: GONG_BASE_HZ * p.ratio,
        start: i * STRIKE_GAP_S,
        peak: level * p.gain,
        attack: p.attack,
        decay: p.decay,
      });
    }
  }
  return voices;
}

/** The parts of an AudioContext the synth uses (a fake in tests). */
export type GongAudio = Pick<
  AudioContext,
  | "currentTime"
  | "destination"
  | "sampleRate"
  | "state"
  | "resume"
  | "createOscillator"
  | "createGain"
  | "createBiquadFilter"
  | "createBuffer"
  | "createBufferSource"
>;

let context: AudioContext | null = null;
function sharedContext(): AudioContext | null {
  if (context) return context;
  const Ctor = globalThis.AudioContext ?? null;
  if (!Ctor) return null;
  try {
    context = new Ctor();
  } catch {
    return null;
  }
  return context;
}

const noiseBuffers = new WeakMap<object, AudioBuffer>();
function noise(ctx: GongAudio): AudioBuffer {
  const cached = noiseBuffers.get(ctx);
  if (cached) return cached;
  const length = Math.max(1, Math.round(ctx.sampleRate * THUMP_SECONDS));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 2;
  noiseBuffers.set(ctx, buffer);
  return buffer;
}

/** Disconnect `nodes` once `source` has ended. */
function releaseOnEnd(source: AudioScheduledSourceNode, nodes: AudioNode[]): void {
  source.onended = () => {
    for (const node of nodes) node.disconnect();
    source.onended = null;
  };
}

/**
 * Ring the gong `strikes` times at `volume` 0..1. Returns the number of
 * voices scheduled (0 when muted, with reduced motion or without Web Audio).
 */
export function playGong(
  strikes: number,
  opts: { volume: number; reducedMotion: boolean; audio?: GongAudio | null },
): number {
  if (opts.reducedMotion) return 0;
  const voices = gongVoices(strikes, opts.volume);
  if (voices.length === 0) return 0;
  const ctx = opts.audio === undefined ? sharedContext() : opts.audio;
  if (!ctx) return 0;
  try {
    if (ctx.state === "suspended") void ctx.resume();
    const t0 = ctx.currentTime + 0.02;
    for (const v of voices) {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = v.hz;
      const env = ctx.createGain();
      const at = t0 + v.start;
      env.gain.setValueAtTime(0.0001, at);
      env.gain.exponentialRampToValueAtTime(v.peak, at + v.attack);
      env.gain.exponentialRampToValueAtTime(0.0001, at + v.decay);
      osc.connect(env).connect(ctx.destination);
      releaseOnEnd(osc, [osc, env]);
      osc.start(at);
      osc.stop(at + v.decay + 0.05);
    }
    for (let i = 0; i < strikes; i++) {
      const at = t0 + i * STRIKE_GAP_S;
      const thump = ctx.createBufferSource();
      thump.buffer = noise(ctx);
      const band = ctx.createBiquadFilter();
      band.type = "bandpass";
      band.frequency.value = 420;
      band.Q.value = 1.2;
      const env = ctx.createGain();
      env.gain.value = GONG_PEAK * 0.8 * Math.min(1, opts.volume);
      thump.connect(band).connect(env).connect(ctx.destination);
      releaseOnEnd(thump, [thump, band, env]);
      thump.start(at);
    }
  } catch {
    // Audio is decoration.
    return 0;
  }
  return voices.length;
}
