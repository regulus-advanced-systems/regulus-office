/**
 * The blast door's klaxon and machinery (#188, SPEC §9.1 "klaxon"),
 * synthesised: no samples.
 *
 * - The klaxon is a rising two-tone horn: a sawtooth and a square a fifth
 *   above it sweep up together, through a low-pass, repeated every
 *   {@link KLAXON_PERIOD_S}.
 * - The door's travel is a low brown-noise rumble with a slow wobble, and
 *   it ends on a deep thud when the leaves meet.
 *
 * Silent at volume 0 (the mute). Every node is disconnected when its
 * source ends.
 */
import { noiseBuffer, releaseOnEnd, type SynthAudio, wake } from "./synth.ts";

export const KLAXON_PERIOD_S = 1.15;
export const KLAXON_PEAK = 0.11;
const RISE_S = 0.55;
const HOLD_S = 0.3;

export interface Whoop {
  /** Seconds after the first. */
  start: number;
  from: number;
  to: number;
}

/** `count` whoops of the horn. */
export function klaxonWhoops(count: number): Whoop[] {
  const out: Whoop[] = [];
  for (let i = 0; i < count; i++) out.push({ start: i * KLAXON_PERIOD_S, from: 210, to: 440 });
  return out;
}

export interface SoundOpts {
  /** The office volume, 0..1 (0 is the mute). */
  volume: number;
  /** How loud at the listener, 0..1 (doorLoudness). */
  loudness: number;
  audio?: SynthAudio | null;
}

function level(opts: SoundOpts): number {
  return Math.min(1, Math.max(0, opts.volume)) * Math.min(1, Math.max(0, opts.loudness));
}

/** Sound `count` whoops; returns the oscillators scheduled (0 muted or without Web Audio). */
export function playKlaxon(count: number, opts: SoundOpts, ctx: SynthAudio | null): number {
  const gain = level(opts) * KLAXON_PEAK;
  if (!(gain > 0) || !(count > 0) || !ctx) return 0;
  let made = 0;
  try {
    wake(ctx);
    const t0 = ctx.currentTime + 0.03;
    for (const w of klaxonWhoops(count)) {
      const at = t0 + w.start;
      const end = at + RISE_S + HOLD_S;
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 1900;
      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, at);
      env.gain.exponentialRampToValueAtTime(gain, at + 0.04);
      env.gain.setValueAtTime(gain, end - 0.06);
      env.gain.exponentialRampToValueAtTime(0.0001, end);
      lp.connect(env).connect(ctx.destination);
      const voices = [
        ["sawtooth", 1, 1],
        ["square", 1.5, 0.35],
      ] as const;
      voices.forEach(([type, ratio, share], i) => {
        const osc = ctx.createOscillator();
        osc.type = type;
        osc.frequency.setValueAtTime(w.from * ratio, at);
        osc.frequency.exponentialRampToValueAtTime(w.to * ratio, at + RISE_S);
        const mix = ctx.createGain();
        mix.gain.value = share;
        osc.connect(mix).connect(lp);
        // The filter and the envelope go with the whoop's last voice.
        releaseOnEnd(osc, i === voices.length - 1 ? [osc, mix, lp, env] : [osc, mix]);
        osc.start(at);
        osc.stop(end + 0.02);
        made += 1;
      });
    }
  } catch {
    return 0;
  }
  return made;
}

/** The leaves' travel: a heavy rumble for `seconds`, ending in a thud when `thud` (the door shut). */
export function playDoorMachinery(
  seconds: number,
  thud: boolean,
  opts: SoundOpts,
  ctx: SynthAudio | null,
): boolean {
  const gain = level(opts) * 0.22;
  if (!(gain > 0) || !ctx || !(seconds > 0)) return false;
  try {
    wake(ctx);
    const t0 = ctx.currentTime + 0.02;
    const rumble = ctx.createBufferSource();
    rumble.buffer = noiseBuffer(ctx, 2, true);
    rumble.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 140;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(gain, t0 + 0.4);
    env.gain.setValueAtTime(gain, t0 + seconds - 0.3);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + seconds);
    rumble.connect(lp).connect(env).connect(ctx.destination);
    releaseOnEnd(rumble, [rumble, lp, env]);
    rumble.start(t0);
    rumble.stop(t0 + seconds + 0.05);
    if (thud) {
      const at = t0 + seconds - 0.05;
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(70, at);
      osc.frequency.exponentialRampToValueAtTime(38, at + 0.5);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(gain * 2.2, at + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.7);
      osc.connect(g).connect(ctx.destination);
      releaseOnEnd(osc, [osc, g]);
      osc.start(at);
      osc.stop(at + 0.75);
    }
  } catch {
    return false;
  }
  return true;
}
