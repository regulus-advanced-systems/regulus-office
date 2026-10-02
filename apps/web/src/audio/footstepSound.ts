/**
 * A tiny generated footstep: a 30 ms band-passed noise burst (no audio
 * files, SPEC §13 asset rules). The AudioContext is created lazily on the
 * first step, which always follows a click or key press, so autoplay policy
 * lets it start.
 */

import { sharedAudioContext as audioContext } from "./context.ts";

let noise: AudioBuffer | null = null;

function noiseBuffer(ctx: AudioContext): AudioBuffer {
  if (noise && noise.sampleRate === ctx.sampleRate) return noise;
  const length = Math.floor(ctx.sampleRate * 0.05);
  noise = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = noise.getChannelData(0);
  let seed = 0x2545f491;
  for (let i = 0; i < length; i++) {
    // Small LCG so the burst is deterministic (tests, reproducibility).
    seed = (seed * 1664525 + 1013904223) >>> 0;
    data[i] = (seed / 0xffffffff) * 2 - 1;
  }
  return noise;
}

/** Play one footstep click; `gain` 0..1. Silently does nothing without WebAudio. */
export function playFootstep(gain = 0.18): void {
  const ctx = audioContext();
  if (!ctx) return;
  try {
    if (ctx.state === "suspended") void ctx.resume();
    const source = ctx.createBufferSource();
    source.buffer = noiseBuffer(ctx);
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 900 + Math.random() * 300;
    filter.Q.value = 1.2;
    const env = ctx.createGain();
    const t = ctx.currentTime;
    env.gain.setValueAtTime(gain, t);
    env.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
    source.connect(filter).connect(env).connect(ctx.destination);
    source.start(t);
    source.stop(t + 0.05);
  } catch {
    // Audio is decoration; never let it break movement.
  }
}
