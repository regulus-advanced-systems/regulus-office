/**
 * The jukebox's bundled tracks (#47): CC-BY 4.0 music by Kevin MacLeod
 * (incompetech.com), re-encoded to 64 kbps mono MP3 so the four of them
 * stay near 6 MB (the jukebox plays in one spot of the lobby, so mono loses
 * nothing). Files live in ../audio/jukebox; ATTRIBUTION.md lists each with
 * its source and licence. The office seeds them into its library at boot
 * and serves them like uploads; `id` is stable across releases.
 */

export interface BundledTrack {
  /** Stable library id (`bundled:` + file stem). */
  id: string;
  /** File name under audio/jukebox. */
  file: string;
  title: string;
  artist: string;
  durationMs: number;
  license: "CC-BY-4.0" | "CC0-1.0";
  /** The attribution line CC-BY asks for, shown in the jukebox panel. */
  attribution: string;
  source: string;
}

const BY_KEVIN = (title: string) =>
  `"${title}" Kevin MacLeod (incompetech.com). Licensed under Creative Commons: By Attribution 4.0 License, http://creativecommons.org/licenses/by/4.0/`;

const track = (
  stem: string,
  title: string,
  durationMs: number,
  isrc: string,
): BundledTrack => ({
  id: `bundled:${stem}`,
  file: `${stem}.mp3`,
  title,
  artist: "Kevin MacLeod",
  durationMs,
  license: "CC-BY-4.0",
  attribution: BY_KEVIN(title),
  source: `https://incompetech.com/music/royalty-free/index.html?isrc=${isrc}`,
});

/** Durations measured with ffprobe on the re-encoded files. */
export const BUNDLED_TRACKS: readonly BundledTrack[] = [
  track("spy-glass", "Spy Glass", 226_978, "USUAN1500058"),
  track("covert-affair", "Covert Affair", 194_194, "USUAN1100795"),
  track("secret-of-tiki-island", "Secret of Tiki Island", 196_075, "USUAN1600037"),
  track("deadly-roulette", "Deadly Roulette", 159_295, "USUAN1600033"),
];

/** Directory of the bundled files, for the server (a file URL). */
export const BUNDLED_AUDIO_DIR = new URL("../audio/jukebox/", import.meta.url);
