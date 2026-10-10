/**
 * The quiet page turn of the room's bookshelf (#264): a short swish of
 * filtered noise whose pitch rises as the page comes over, then a soft tap
 * as it lands. Generated with WebAudio, no audio file (SPEC §12 asset
 * rules). Played when a document opens; off with the "Page-turn sound"
 * setting or at volume 0.
 */
import { sharedAudioContext as audioContext } from "./context.ts";

export const PAGE_TURN_SECONDS = 0.22;
/** Peak gain at full office volume: well under the ding's. */
export const PAGE_TURN_PEAK = 0.05;

let noise: AudioBuffer | null = null;

function noiseBuffer(ctx: AudioContext): AudioBuffer {
  if (noise && noise.sampleRate === ctx.sampleRate) return noise;
  const length = Math.floor(ctx.sampleRate * (PAGE_TURN_SECONDS + 0.05));
  noise = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = noise.getChannelData(0);
  let seed = 0x9e3779b9;
  for (let i = 0; i < length; i++) {
    // Small LCG so the swish is the same every time.
    seed = (seed * 1664525 + 1013904223) >>> 0;
    data[i] = (seed / 0xffffffff) * 2 - 1;
  }
  return noise;
}

/** Whether a page turn should sound at all. */
export function pageTurnGain(settings: { pageTurnSound: boolean; volume: number }): number {
  if (!settings.pageTurnSound || !(settings.volume > 0)) return 0;
  return PAGE_TURN_PEAK * Math.min(1, settings.volume);
}

/** Play one page turn at `gain` (from {@link pageTurnGain}). Does nothing without WebAudio. */
export function playPageTurn(gain: number): void {
  if (!(gain > 0)) return;
  const ctx = audioContext();
  if (!ctx) return;
  try {
    if (ctx.state === "suspended") void ctx.resume();
    const t = ctx.currentTime;
    const source = ctx.createBufferSource();
    source.buffer = noiseBuffer(ctx);
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.Q.value = 0.8;
    filter.frequency.setValueAtTime(1400, t);
    filter.frequency.exponentialRampToValueAtTime(5200, t + PAGE_TURN_SECONDS * 0.7);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(gain, t + 0.05);
    env.gain.exponentialRampToValueAtTime(gain * 0.35, t + PAGE_TURN_SECONDS * 0.7);
    // The page lands.
    env.gain.exponentialRampToValueAtTime(gain * 0.8, t + PAGE_TURN_SECONDS * 0.78);
    env.gain.exponentialRampToValueAtTime(0.0001, t + PAGE_TURN_SECONDS);
    source.connect(filter).connect(env).connect(ctx.destination);
    source.start(t);
    source.stop(t + PAGE_TURN_SECONDS + 0.03);
  } catch {
    // Audio is decoration.
  }
}
