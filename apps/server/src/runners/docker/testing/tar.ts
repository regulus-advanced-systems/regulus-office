/**
 * Minimal ustar writer for the Engine API's archive endpoints
 * (`PUT /containers/{id}/archive`, `POST /build`). Regular files only, names up
 * to 100 bytes (callers extract into the file's parent directory, so names are
 * basenames or short relative paths).
 */

export interface TarEntry {
  name: string;
  data: string | Uint8Array;
  /** POSIX permission bits, default 0o600. */
  mode?: number;
  uid?: number;
  gid?: number;
}

const BLOCK = 512;
const encoder = new TextEncoder();

export function tar(entries: readonly TarEntry[]): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const entry of entries) {
    const data = typeof entry.data === "string" ? encoder.encode(entry.data) : entry.data;
    parts.push(header(entry, data.byteLength), data, new Uint8Array(pad(data.byteLength)));
  }
  parts.push(new Uint8Array(BLOCK * 2));
  const out = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.byteLength;
  }
  return out;
}

function pad(size: number): number {
  return (BLOCK - (size % BLOCK)) % BLOCK;
}

function header(entry: TarEntry, size: number): Uint8Array {
  const name = encoder.encode(entry.name);
  if (name.byteLength === 0 || name.byteLength > 100) {
    throw new Error(`tar entry name must be 1-100 bytes: ${entry.name}`);
  }
  const h = new Uint8Array(BLOCK);
  const put = (offset: number, bytes: Uint8Array) => h.set(bytes, offset);
  const octal = (offset: number, width: number, value: number) =>
    put(offset, encoder.encode(`${value.toString(8).padStart(width - 1, "0")}\0`));

  put(0, name);
  octal(100, 8, (entry.mode ?? 0o600) & 0o7777);
  octal(108, 8, entry.uid ?? 0);
  octal(116, 8, entry.gid ?? 0);
  octal(124, 12, size);
  octal(136, 12, Math.floor(Date.now() / 1000));
  put(148, encoder.encode("        "));
  h[156] = "0".charCodeAt(0);
  put(257, encoder.encode("ustar\0"));
  put(263, encoder.encode("00"));
  let sum = 0;
  for (const byte of h) sum += byte;
  put(148, encoder.encode(`${sum.toString(8).padStart(6, "0")}\0 `));
  return h;
}
