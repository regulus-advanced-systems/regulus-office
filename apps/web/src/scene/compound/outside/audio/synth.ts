/**
 * Shared Web Audio plumbing for the outside's sounds (#188): the office's one
 * AudioContext (audio/context.ts) for the klaxon, the door's rumble and the beach
 * ambience, a seeded noise buffer, and node clean-up. No samples anywhere
 * (SPEC §13 asset rules): every sound is synthesised.
 */

import { sharedAudioContext } from "../../../../audio/context.ts";

/** The parts of an AudioContext the outside's synths use (a fake in tests). */
export type SynthAudio = Pick<
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

/** The office's one AudioContext (audio/context.ts), created on first use. */
export function outsideAudio(): SynthAudio | null {
  return sharedAudioContext();
}

/** Resume a context the browser suspended (autoplay); harmless when running. */
export function wake(ctx: SynthAudio): void {
  if (ctx.state === "suspended") void ctx.resume().catch(() => undefined);
}

/** Disconnect `nodes` once `source` has ended, so repeated sounds leave nothing behind. */
export function releaseOnEnd(source: AudioScheduledSourceNode, nodes: AudioNode[]): void {
  source.onended = () => {
    for (const node of nodes) node.disconnect();
    source.onended = null;
  };
}

const buffers = new WeakMap<object, Map<string, AudioBuffer>>();

/**
 * A noise buffer: `brown` integrates white noise (deep rumble, surf),
 * otherwise white. Deterministic (a small LCG), cached per context.
 */
export function noiseBuffer(ctx: SynthAudio, seconds: number, brown = false): AudioBuffer {
  const key = `${seconds}:${brown}`;
  let byKey = buffers.get(ctx);
  const hit = byKey?.get(key);
  if (hit) return hit;
  const length = Math.max(1, Math.round(ctx.sampleRate * seconds));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let seed = 0x1f2e3d4c;
  let last = 0;
  for (let i = 0; i < length; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const white = (seed / 0xffffffff) * 2 - 1;
    if (brown) {
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.5;
    } else data[i] = white;
  }
  if (!byKey) {
    byKey = new Map();
    buffers.set(ctx, byKey);
  }
  byKey.set(key, buffer);
  return buffer;
}

/** How loud the door's sounds are `distance` metres away: full nearby, faint across the compound. */
export function doorLoudness(distance: number): number {
  if (!(distance > 12)) return 1;
  return Math.max(0.08, 1 - (distance - 12) / 70);
}
