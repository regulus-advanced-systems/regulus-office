/**
 * Proximity voice (#48, D5): how loud each voice is where the player
 * stands, and which voices to receive at all. Pure.
 *
 * Loudness is the shared spatial curve (audio/spatial.ts, VOICE_FALLOFF:
 * clear within 2 m, gone by 18 m) times the room occlusion the jukebox
 * uses (a fifth through a wall into another room, half into the
 * corridors). Distance is the straight line, not the walking distance of
 * audio/soundField.ts: every speaker moves, and a nav-grid search per
 * speaker several times a second costs far more than it changes inside an
 * 18 m reach; the occlusion factor already accounts for walls (voiceOcclusion).
 *
 * Receiving: only the nearest `max` voices that can be heard (bandwidth
 * stays bounded however big the office), with a little hysteresis so a
 * voice at the edge does not flap on and off.
 */
import { VOICE_MAX_SUBSCRIPTIONS } from "@regulus/protocol";
import { attenuation, type Falloff, OCCLUSION, VOICE_FALLOFF } from "../audio/spatial.ts";

export interface VoiceListener {
  x: number;
  z: number;
  /** Room id the listener is in; null in the corridors and outside. */
  roomId: string | null;
}

export interface VoiceSource extends VoiceListener {
  /** LiveKit identity = building session id. */
  id: string;
}

export interface VoicePlan {
  /** Identities to receive. */
  subscribe: Set<string>;
  /** Gain 0..1 for every source (0 when out of reach). */
  gains: Map<string, number>;
}

/** Keep receiving a voice until this many metres past the silent edge. */
export const VOICE_HYSTERESIS_M = 3;

export interface PlanOptions {
  max?: number;
  falloff?: Falloff;
  /** Identities received now (for hysteresis). */
  current?: ReadonlySet<string>;
}

/**
 * The walls between two people: none in the same room (or both in the
 * corridors), a doorway when one of them is in the corridors or outside,
 * a wall and a doorway between two rooms. Symmetric, unlike the jukebox's
 * (which always stands in the lobby): either person may be the one outside.
 */
export function voiceOcclusion(a: string | null, b: string | null): number {
  if (a === b) return 1;
  return a === null || b === null ? OCCLUSION.corridor : OCCLUSION.otherRoom;
}

/** The gain of one voice at the listener. */
export function voiceGain(
  listener: VoiceListener,
  source: VoiceListener,
  falloff: Falloff = VOICE_FALLOFF,
): number {
  const d = Math.hypot(source.x - listener.x, source.z - listener.z);
  return attenuation(d, falloff) * voiceOcclusion(source.roomId, listener.roomId);
}

export function planVoices(
  listener: VoiceListener,
  sources: readonly VoiceSource[],
  options: PlanOptions = {},
): VoicePlan {
  const max = options.max ?? VOICE_MAX_SUBSCRIPTIONS;
  const falloff = options.falloff ?? VOICE_FALLOFF;
  const current = options.current ?? new Set<string>();
  const gains = new Map<string, number>();
  const candidates: Array<{ id: string; d: number }> = [];
  for (const s of sources) {
    const d = Math.hypot(s.x - listener.x, s.z - listener.z);
    const gain = voiceGain(listener, s, falloff);
    gains.set(s.id, gain);
    const keep = current.has(s.id) && d < falloff.maxDistance + VOICE_HYSTERESIS_M;
    if (gain > 0 || keep) candidates.push({ id: s.id, d });
  }
  candidates.sort((a, b) => a.d - b.d || a.id.localeCompare(b.id));
  return { subscribe: new Set(candidates.slice(0, max).map((c) => c.id)), gains };
}
