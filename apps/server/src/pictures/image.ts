/**
 * Wall picture images (#46, SPEC §11 "uploads validated by magic bytes"):
 * what kind of image a file is and how big, read from its own bytes (never
 * from the name or the client's content type), and the same image with its
 * metadata dropped.
 *
 * The office has no image decoder, so nothing is re-encoded here (the
 * browser re-encodes through a canvas before uploading, which already drops
 * everything but the pixels). The server still walks the file's container
 * and keeps only what drawing it needs:
 *
 * - PNG: the critical chunks plus colour, transparency and animation chunks;
 *   text (`tEXt`, `zTXt`, `iTXt`), `eXIf`, `tIME` and unknown chunks go.
 * - JPEG: every APPn segment except JFIF (APP0), the ICC profile (APP2) and
 *   Adobe's colour transform (APP14), and comments (COM) go; EXIF and XMP
 *   (camera, GPS position, editing history) are APP1.
 * - WebP: the `EXIF` and `XMP ` chunks go and their VP8X flags are cleared.
 *
 * A container that does not parse (truncated, lengths out of range, no
 * dimensions) is not an image.
 */
import type { WallPictureKind } from "@regulus/protocol";

export interface ImageInfo {
  kind: WallPictureKind;
  width: number;
  height: number;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const ascii = (b: Uint8Array, at: number, n: number) =>
  String.fromCharCode(...b.subarray(at, at + n));
const be32 = (b: Uint8Array, at: number) =>
  (b[at] ?? 0) * 2 ** 24 + ((b[at + 1] ?? 0) << 16) + (((b[at + 2] ?? 0) << 8) | (b[at + 3] ?? 0));
const be16 = (b: Uint8Array, at: number) => ((b[at] ?? 0) << 8) | (b[at + 1] ?? 0);
const le32 = (b: Uint8Array, at: number) =>
  ((b[at] ?? 0) | ((b[at + 1] ?? 0) << 8) | ((b[at + 2] ?? 0) << 16)) + (b[at + 3] ?? 0) * 2 ** 24;
const le24 = (b: Uint8Array, at: number) =>
  (b[at] ?? 0) | ((b[at + 1] ?? 0) << 8) | ((b[at + 2] ?? 0) << 16);

/** The image's kind from its magic bytes alone, or null. */
export function sniffKind(b: Uint8Array): WallPictureKind | null {
  if (b.length >= 8 && PNG_SIGNATURE.every((v, i) => b[i] === v)) return "png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (b.length >= 12 && ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP") return "webp";
  return null;
}

function concat(parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

// ---- PNG -------------------------------------------------------------------

const PNG_KEEP = new Set([
  "IHDR",
  "PLTE",
  "IDAT",
  "IEND",
  "tRNS",
  "gAMA",
  "cHRM",
  "sRGB",
  "iCCP",
  "sBIT",
  "pHYs",
  "bKGD",
  "acTL",
  "fcTL",
  "fdAT",
]);

function png(b: Uint8Array): { info: ImageInfo; clean: Uint8Array<ArrayBuffer> } | null {
  const parts: Uint8Array[] = [b.subarray(0, 8)];
  let at = 8;
  let info: ImageInfo | null = null;
  let ended = false;
  while (at + 12 <= b.length) {
    const len = be32(b, at);
    const type = ascii(b, at + 4, 4);
    const end = at + 12 + len;
    if (end > b.length) return null;
    if (at === 8) {
      if (type !== "IHDR" || len < 8) return null;
      info = { kind: "png", width: be32(b, at + 8), height: be32(b, at + 12) };
    }
    if (PNG_KEEP.has(type)) parts.push(b.subarray(at, end));
    at = end;
    if (type === "IEND") {
      ended = true;
      break;
    }
  }
  if (!info || !ended) return null;
  return { info, clean: concat(parts) };
}

// ---- JPEG ------------------------------------------------------------------

const SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

function keepJpegSegment(marker: number, b: Uint8Array, data: number): boolean {
  if (marker === 0xfe) return false; // COM
  if (marker < 0xe0 || marker > 0xef) return true;
  if (marker === 0xe0) return true; // JFIF
  if (marker === 0xe2) return ascii(b, data, 12) === "ICC_PROFILE\0";
  if (marker === 0xee) return ascii(b, data, 5) === "Adobe";
  return false;
}

function jpeg(b: Uint8Array): { info: ImageInfo; clean: Uint8Array<ArrayBuffer> } | null {
  const parts: Uint8Array[] = [b.subarray(0, 2)];
  let at = 2;
  let info: ImageInfo | null = null;
  while (at < b.length) {
    if (b[at] !== 0xff) return null;
    // Fill bytes: any number of 0xFF before a marker.
    while (b[at + 1] === 0xff) at += 1;
    const marker = b[at + 1] ?? 0;
    if (marker === 0xd9) return null; // EOI before any scan
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      parts.push(b.subarray(at, at + 2));
      at += 2;
      continue;
    }
    if (at + 4 > b.length) return null;
    const len = be16(b, at + 2);
    const end = at + 2 + len;
    if (len < 2 || end > b.length) return null;
    if (SOF.has(marker)) {
      if (len < 7) return null;
      info = { kind: "jpeg", height: be16(b, at + 5), width: be16(b, at + 7) };
    }
    if (marker === 0xda) {
      // Start of scan: the entropy-coded data and everything after it is kept as it is.
      if (!info) return null;
      parts.push(b.subarray(at));
      return { info, clean: concat(parts) };
    }
    if (keepJpegSegment(marker, b, at + 4)) parts.push(b.subarray(at, end));
    at = end;
  }
  return null;
}

// ---- WebP ------------------------------------------------------------------

const VP8X_EXIF = 0x08;
const VP8X_XMP = 0x04;

function webpSize(fourcc: string, b: Uint8Array, data: number, len: number) {
  if (fourcc === "VP8X" && len >= 10)
    return { width: le24(b, data + 4) + 1, height: le24(b, data + 7) + 1 };
  if (fourcc === "VP8L" && len >= 5 && b[data] === 0x2f) {
    const bits = le32(b, data + 1);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (fourcc === "VP8 " && len >= 10) {
    if (b[data + 3] !== 0x9d || b[data + 4] !== 0x01 || b[data + 5] !== 0x2a) return null;
    return {
      width: (b[data + 6] ?? 0) | (((b[data + 7] ?? 0) & 0x3f) << 8),
      height: (b[data + 8] ?? 0) | (((b[data + 9] ?? 0) & 0x3f) << 8),
    };
  }
  return null;
}

function webp(b: Uint8Array): { info: ImageInfo; clean: Uint8Array<ArrayBuffer> } | null {
  const riffEnd = 8 + le32(b, 4);
  if (riffEnd > b.length || riffEnd < 12) return null;
  const parts: Uint8Array[] = [];
  let at = 12;
  let info: ImageInfo | null = null;
  while (at + 8 <= riffEnd) {
    const fourcc = ascii(b, at, 4);
    const len = le32(b, at + 4);
    const end = at + 8 + len + (len % 2);
    if (at + 8 + len > riffEnd) return null;
    if (!info) {
      const size = webpSize(fourcc, b, at + 8, len);
      if (size) info = { kind: "webp", ...size };
    }
    if (fourcc === "EXIF" || fourcc === "XMP ") {
      at = end;
      continue;
    }
    const chunk = b.slice(at, Math.min(end, riffEnd));
    if (fourcc === "VP8X" && chunk.length > 8) chunk[8] = (chunk[8] ?? 0) & ~(VP8X_EXIF | VP8X_XMP);
    parts.push(chunk);
    at = end;
  }
  if (!info) return null;
  const body = concat(parts);
  const head = new Uint8Array(12);
  head.set(b.subarray(0, 12));
  new DataView(head.buffer).setUint32(4, body.length + 4, true);
  return { info, clean: concat([head, body]) };
}

/**
 * The image's kind and size, and its bytes with the metadata dropped; null
 * when `bytes` is not a PNG, JPEG or WebP that parses.
 */
export function inspectImage(
  bytes: Uint8Array,
): { info: ImageInfo; clean: Uint8Array<ArrayBuffer> } | null {
  const kind = sniffKind(bytes);
  const out =
    kind === "png" ? png(bytes) : kind === "jpeg" ? jpeg(bytes) : kind ? webp(bytes) : null;
  if (!out || out.info.width < 1 || out.info.height < 1) return null;
  return out;
}

/** File extension for a stored picture. */
export const PICTURE_EXT: Readonly<Record<WallPictureKind, string>> = {
  png: "png",
  jpeg: "jpg",
  webp: "webp",
};
