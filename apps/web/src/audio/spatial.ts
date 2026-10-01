/**
 * Spatial loudness for sounds placed in the compound (#47; #48 proximity
 * voice reuses it). A sound source has a position, a listener has one, and
 * between them a distance in metres; this module turns that distance into
 * a gain and applies it smoothly to a Web Audio node.
 *
 * Distance is whatever the caller measures: straight-line for open space,
 * or the walking distance through the compound from soundField.ts, which
 * makes walls and shut doors count (sound goes round through the doorway).
 * No PannerNode: the camera orbits the player and the HRTF panning would
 * swing with it; a mono gain-by-distance reads better in a 3/4 view.
 *
 * Curve (`attenuation`): full level within `refDistance`, then inverse
 * distance (`refDistance / d`, the Web Audio "inverse" model with rolloff
 * 1), faded to exactly 0 between `fadeStart` and `maxDistance` with a
 * smoothstep, so a source is silent past `maxDistance` instead of an
 * endless faint tail.
 *
 * Usage:
 *   const voice = createSpatialGain(ctx, ctx.destination);
 *   source.connect(voice.input);
 *   voice.set(volume * attenuation(distance, JUKEBOX_FALLOFF));   // e.g. 4x a second
 *   voice.dispose();
 */

export interface Falloff {
  /** Full level up to this distance, metres. */
  refDistance: number;
  /** The fade to silence starts here, metres. */
  fadeStart: number;
  /** Silent from here on, metres. */
  maxDistance: number;
}

/**
 * The jukebox in the lobby: full level in front of it, about half across the
 * lounge, a quarter at the far wall of the lobby (~25 m walked), faint in
 * the corridors beyond its door and silent past 55 m walked, i.e. deep in
 * the project rooms.
 */
export const JUKEBOX_FALLOFF: Falloff = { refDistance: 6, fadeStart: 32, maxDistance: 55 };

/**
 * A voice nearby (#48): clear at conversation distance, gone across a big
 * room. Here so the two features share one curve shape.
 */
export const VOICE_FALLOFF: Falloff = { refDistance: 2, fadeStart: 10, maxDistance: 18 };

const smoothstep = (t: number) => {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
};

/** Gain 0..1 for a listener `distance` metres from the source (Infinity = unreachable: 0). */
export function attenuation(distance: number, falloff: Falloff): number {
  if (!(distance >= 0)) return distance < 0 ? 1 : 0;
  if (!Number.isFinite(distance) || distance >= falloff.maxDistance) return 0;
  const inverse = distance <= falloff.refDistance ? 1 : falloff.refDistance / distance;
  const span = falloff.maxDistance - falloff.fadeStart;
  const fade = span > 0 ? 1 - smoothstep((distance - falloff.fadeStart) / span) : 1;
  return inverse * fade;
}

/**
 * Walls between source and listener (cheap occlusion): the walking distance
 * already sends the sound round through the doorway; a doorway and a wall
 * still swallow some of it. Same room: 1; listener in the corridors or
 * outside (no room): `corridor`; in another room: `otherRoom`.
 */
export const OCCLUSION = { corridor: 0.5, otherRoom: 0.2 } as const;

export function roomOcclusion(sourceRoom: string | null, listenerRoom: string | null): number {
  if (sourceRoom === listenerRoom) return 1;
  return listenerRoom === null ? OCCLUSION.corridor : OCCLUSION.otherRoom;
}

/** Seconds for a gain change to settle (setTargetAtTime's time constant): no zipper noise. */
export const GAIN_SMOOTHING_S = 0.12;

export interface SpatialGain {
  /** Connect the source here. */
  readonly input: GainNode;
  /** Glide to `gain` (0..1, everything folded in: volume, mute, attenuation). */
  set(gain: number): void;
  /** The last gain asked for. */
  readonly gain: number;
  dispose(): void;
}

/** A gain node into `output` whose level glides; starts silent. */
export function createSpatialGain(
  ctx: Pick<BaseAudioContext, "createGain" | "currentTime">,
  output: AudioNode,
): SpatialGain {
  const node = ctx.createGain();
  node.gain.value = 0;
  node.connect(output);
  let target = 0;
  return {
    input: node,
    get gain() {
      return target;
    },
    set(gain) {
      const g = Math.min(1, Math.max(0, Number.isFinite(gain) ? gain : 0));
      if (Math.abs(g - target) < 1e-4) return;
      target = g;
      node.gain.setTargetAtTime(g, ctx.currentTime, GAIN_SMOOTHING_S);
    },
    dispose() {
      node.disconnect();
    },
  };
}
