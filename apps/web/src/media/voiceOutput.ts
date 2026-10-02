/**
 * Remote voices into the office's one AudioContext (#48; audio/context.ts):
 * each received mic track → its own spatial gain (audio/spatial.ts, set by
 * the proximity plan) → a voice master (Settings volume × voice volume) →
 * the speakers. LiveKit's own audio elements are never attached, so a voice
 * is only ever heard at the level the plan gives it.
 *
 * Chrome only feeds a remote WebRTC track into Web Audio while the stream
 * also plays in a media element, so each voice gets a muted <audio> too.
 * Without Web Audio (old browsers) the element plays unmuted with its
 * `volume` as the gain.
 */
import { sharedAudioContext } from "../audio/context.ts";
import { createSpatialGain, GAIN_SMOOTHING_S, type SpatialGain } from "../audio/spatial.ts";

type Ctx = Pick<
  AudioContext,
  "createGain" | "createMediaStreamSource" | "currentTime" | "destination"
>;

export interface VoiceOutputDeps {
  audio?: () => Ctx | null;
  makeElement?: () => HTMLAudioElement;
  makeStream?: (track: MediaStreamTrack) => MediaStream;
}

interface Voice {
  track: MediaStreamTrack;
  element: HTMLAudioElement;
  source: AudioNode | null;
  gain: SpatialGain | null;
  level: number;
}

export interface VoiceOutput {
  /** Start playing a received mic track for `id` (silent until `setGain`). */
  attach(id: string, track: MediaStreamTrack): void;
  detach(id: string): void;
  /** Spatial level 0..1 for one voice. */
  setGain(id: string, gain: number): void;
  /** Every voice's overall level 0..1 (office volume × voice volume). */
  setMaster(level: number): void;
  /** Ids playing now. */
  ids(): string[];
  /** The last gain asked for (tests, e2e probe). */
  gainOf(id: string): number | null;
  dispose(): void;
}

const clamp = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

export function createVoiceOutput(deps: VoiceOutputDeps = {}): VoiceOutput {
  const audio = deps.audio ?? sharedAudioContext;
  const makeElement = deps.makeElement ?? (() => new Audio());
  const makeStream = deps.makeStream ?? ((track) => new MediaStream([track]));
  const voices = new Map<string, Voice>();
  let master: GainNode | null = null;
  let masterLevel = 1;

  const masterNode = (ctx: Ctx): GainNode => {
    if (!master) {
      master = ctx.createGain();
      master.gain.value = masterLevel;
      master.connect(ctx.destination);
    }
    return master;
  };

  const elementVolume = (v: Voice) => {
    if (!v.gain) v.element.volume = clamp(v.level * masterLevel);
  };

  return {
    attach(id, track) {
      const existing = voices.get(id);
      if (existing?.track === track) return;
      if (existing) this.detach(id);
      const stream = makeStream(track);
      const element = makeElement();
      element.autoplay = true;
      element.srcObject = stream;
      const ctx = audio();
      let source: AudioNode | null = null;
      let gain: SpatialGain | null = null;
      if (ctx) {
        element.muted = true;
        source = ctx.createMediaStreamSource(stream);
        gain = createSpatialGain(ctx, masterNode(ctx));
        source.connect(gain.input);
      } else {
        element.muted = false;
        element.volume = 0;
      }
      void element.play?.()?.catch?.(() => undefined);
      voices.set(id, { track, element, source, gain, level: 0 });
    },

    detach(id) {
      const v = voices.get(id);
      if (!v) return;
      voices.delete(id);
      v.source?.disconnect();
      v.gain?.dispose();
      v.element.pause?.();
      v.element.srcObject = null;
    },

    setGain(id, level) {
      const v = voices.get(id);
      if (!v) return;
      v.level = clamp(level);
      v.gain?.set(v.level);
      elementVolume(v);
    },

    setMaster(level) {
      const next = clamp(level);
      if (next === masterLevel) return;
      masterLevel = next;
      const ctx = audio();
      if (master && ctx) master.gain.setTargetAtTime(next, ctx.currentTime, GAIN_SMOOTHING_S);
      for (const v of voices.values()) elementVolume(v);
    },

    ids: () => [...voices.keys()],

    gainOf: (id) => voices.get(id)?.level ?? null,

    dispose() {
      for (const id of [...voices.keys()]) this.detach(id);
      master?.disconnect();
      master = null;
    },
  };
}
