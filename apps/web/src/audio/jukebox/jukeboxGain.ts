/** The jukebox's loudness on this page (#47): the file player and the YouTube panel apply it. */

export interface GainInput {
  /** Settings → volume, 0..1. */
  volume: number;
  /** Settings → mute the jukebox. */
  muted: boolean;
  /** The jukebox's office-wide level, 0..1. */
  officeVolume: number;
  /** Spatial level where the player stands, 0..1 (scene/jukebox/JukeboxDriver). */
  level: number;
}

export function jukeboxGain(g: GainInput): number {
  if (g.muted) return 0;
  const clamp = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);
  return clamp(g.volume) * clamp(g.officeVolume) * clamp(g.level);
}
