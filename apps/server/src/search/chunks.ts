/**
 * Scrollback → index chunks (#41).
 *
 * A snapshot is the newest ~10k lines of a pane (terminals/scrollback.ts),
 * rewritten every 15 s while the robot works: lines are appended at the
 * bottom and fall off the top. To re-index only what changed, the text is cut
 * into chunks at content-defined boundaries (a line whose hash hits a
 * pattern, within a min/max size), so the same lines produce the same chunks
 * wherever they sit in the file. The indexer then diffs chunk hashes: kept
 * chunks stay, new ones are inserted, vanished ones are deleted.
 */

export interface Chunk {
  /** Hex hash of `body`; identical chunks of one agent are stored once. */
  hash: string;
  body: string;
}

export interface ChunkOptions {
  /** A boundary is only taken after at least this many lines. */
  minLines?: number;
  /** A chunk is cut at this many lines whatever the content. */
  maxLines?: number;
  /** A chunk is cut before it grows past this many characters. */
  maxChars?: number;
  /** One in `modulus` lines is a boundary candidate. */
  modulus?: number;
}

const DEFAULTS: Required<ChunkOptions> = { minLines: 8, maxLines: 48, maxChars: 6000, modulus: 16 };

/** 32-bit FNV-1a, stable across runs and platforms. */
export function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function hashOf(body: string): string {
  return Bun.hash(body).toString(16);
}

/** Split plain scrollback text into chunks; blank-only chunks are dropped. */
export function chunkScrollback(text: string, options: ChunkOptions = {}): Chunk[] {
  const o = { ...DEFAULTS, ...options };
  const lines = text.split("\n").map((l) => l.trimEnd());
  const out: Chunk[] = [];
  let current: string[] = [];
  let chars = 0;
  const cut = () => {
    // Trim blank lines at the edges so a shifted blank line does not change the hash.
    while (current.length && current[0] === "") current.shift();
    while (current.length && current.at(-1) === "") current.pop();
    if (current.length) {
      const body = current.join("\n");
      out.push({ hash: hashOf(body), body });
    }
    current = [];
    chars = 0;
  };
  for (const line of lines) {
    if (current.length && chars + line.length > o.maxChars) cut();
    current.push(line.slice(0, o.maxChars));
    chars += line.length + 1;
    const boundary = current.length >= o.minLines && fnv1a(line) % o.modulus === 0;
    if (boundary || current.length >= o.maxLines) cut();
  }
  cut();
  return out;
}
