/**
 * The soft "ding" a robot makes when it raises its hand (SPEC §9.3 waiting
 * for permission or input). Generated with WebAudio (two sine partials with
 * a bell envelope), no audio files. Silent with reduced motion or volume 0
 * (the settings the footsteps follow too), and rate-limited so a floor of
 * robots asking at once does not become a chime.
 */

let context: AudioContext | null = null;

function audioContext(): AudioContext | null {
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

/** Partials of the ding: a soft E6 with a quieter fifth above it. */
export const DING_PARTIALS: ReadonlyArray<{ hz: number; gain: number; decay: number }> = [
  { hz: 1318.5, gain: 1, decay: 0.9 },
  { hz: 1975.5, gain: 0.35, decay: 0.5 },
];
export const DING_PEAK = 0.12;

/** Play one ding at `volume` 0..1. Does nothing without WebAudio. */
export function playDing(volume: number): void {
  if (!(volume > 0)) return;
  const ctx = audioContext();
  if (!ctx) return;
  try {
    if (ctx.state === "suspended") void ctx.resume();
    const t = ctx.currentTime;
    for (const p of DING_PARTIALS) {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = p.hz;
      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, t);
      env.gain.exponentialRampToValueAtTime(DING_PEAK * p.gain * volume, t + 0.01);
      env.gain.exponentialRampToValueAtTime(0.0001, t + p.decay);
      osc.connect(env).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + p.decay + 0.05);
    }
  } catch {
    // Audio is decoration.
  }
}

export const DING_MIN_INTERVAL_MS = 1500;

/**
 * Decides whether a ding may play now: not muted, not reduced motion, and
 * not within `minIntervalMs` of the last one.
 */
export function createDingGate(minIntervalMs = DING_MIN_INTERVAL_MS) {
  let last = Number.NEGATIVE_INFINITY;
  return (opts: { now: number; volume: number; reducedMotion: boolean }): boolean => {
    if (opts.reducedMotion || !(opts.volume > 0)) return false;
    if (opts.now - last < minIntervalMs) return false;
    last = opts.now;
    return true;
  };
}
