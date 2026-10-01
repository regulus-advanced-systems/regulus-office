/**
 * Audio uploads are recognised by their magic bytes (SPEC §11), never by the
 * file name or the browser's content type. Only formats every browser the
 * office supports can play through an `<audio>` element are accepted.
 */

export interface AudioKind {
  /** Content type the file is served with. */
  mime: string;
  /** Extension it is stored under. */
  ext: string;
}

export const AUDIO_KINDS = {
  mp3: { mime: "audio/mpeg", ext: "mp3" },
  ogg: { mime: "audio/ogg", ext: "ogg" },
  flac: { mime: "audio/flac", ext: "flac" },
  wav: { mime: "audio/wav", ext: "wav" },
  m4a: { mime: "audio/mp4", ext: "m4a" },
  webm: { mime: "audio/webm", ext: "webm" },
} as const satisfies Record<string, AudioKind>;

/** Bytes `sniffAudio` needs to see. */
export const SNIFF_BYTES = 16;

const ascii = (b: Uint8Array, at: number, text: string) => {
  for (let i = 0; i < text.length; i++) if (b[at + i] !== text.charCodeAt(i)) return false;
  return true;
};

/** MPEG audio frame header: 11 sync bits, a valid version, layer III and a usable bitrate. */
function mpegFrame(b: Uint8Array): boolean {
  const b0 = b[0] ?? 0;
  const b1 = b[1] ?? 0;
  const b2 = b[2] ?? 0;
  if (b0 !== 0xff || (b1 & 0xe0) !== 0xe0) return false;
  const version = (b1 >> 3) & 0b11;
  const layer = (b1 >> 1) & 0b11;
  const bitrate = b2 >> 4;
  const rate = (b2 >> 2) & 0b11;
  return version !== 0b01 && layer === 0b01 && bitrate !== 0 && bitrate !== 0xf && rate !== 0b11;
}

/** The audio format of a file from its first bytes, or null when it is not one we take. */
export function sniffAudio(head: Uint8Array): AudioKind | null {
  if (head.length < 4) return null;
  if (ascii(head, 0, "ID3") || mpegFrame(head)) return AUDIO_KINDS.mp3;
  if (ascii(head, 0, "OggS")) return AUDIO_KINDS.ogg;
  if (ascii(head, 0, "fLaC")) return AUDIO_KINDS.flac;
  if (head.length >= 12 && ascii(head, 0, "RIFF") && ascii(head, 8, "WAVE")) return AUDIO_KINDS.wav;
  if (head.length >= 12 && ascii(head, 4, "ftyp")) {
    // MP4 audio brands only: a video or an image (HEIF/AVIF) in an MP4 box is not a track.
    const brand = String.fromCharCode(...head.subarray(8, 12));
    if (["M4A ", "M4B ", "mp42", "isom", "dash"].includes(brand)) return AUDIO_KINDS.m4a;
    return null;
  }
  if (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3)
    return AUDIO_KINDS.webm;
  return null;
}

/** Content type of a stored track from its extension; octet-stream for anything else. */
export function mimeForFile(path: string): string {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  for (const kind of Object.values(AUDIO_KINDS)) if (kind.ext === ext) return kind.mime;
  return "application/octet-stream";
}
