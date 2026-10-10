/**
 * The part of a matching line a search hit shows (#264), built while the
 * line streams past, in bounded memory however long the line is.
 *
 * A hit that does not show its match is confusing, so: when the match ends
 * within the first quarter of what is kept, the excerpt is the start of the
 * line; otherwise it is a window around the first match, marked with a
 * leading ellipsis. The match is found byte by byte with a prefix table
 * (no rescanning), ignoring ASCII case. git matches with full case folding;
 * a match this cannot see (non-ASCII letters in another case) falls back to
 * the start of the line.
 */

/** Bytes shown before the match when the excerpt is a window. */
export const EXCERPT_LEAD_BYTES = 80;
export const ELLIPSIS = String.fromCodePoint(0x2026);
/** What the decoder puts where a character was cut in two (U+FFFD), at either end. */
const CUT = String.fromCodePoint(0xfffd);
const BROKEN_START = new RegExp(`^${CUT}+`);
const BROKEN_END = new RegExp(`${CUT}+$`);

const lower = (byte: number) => (byte >= 65 && byte <= 90 ? byte + 32 : byte);

export class LineExcerpt {
  readonly #needle: number[];
  readonly #fallback: number[];
  readonly #maxBytes: number;
  readonly #head: number[] = [];
  /** The last bytes seen, for the lead of a window. */
  #recent: number[] = [];
  #window: number[] | null = null;
  #matched = 0;
  #seen = 0;
  #done = false;

  constructor(needle: string, maxBytes: number) {
    this.#needle = [...new TextEncoder().encode(needle)].map(lower);
    this.#maxBytes = maxBytes;
    // For each prefix of the needle, the longest proper prefix that is also its suffix.
    this.#fallback = this.#needle.map(() => 0);
    for (let i = 1, k = 0; i < this.#needle.length; i++) {
      while (k > 0 && this.#needle[i] !== this.#needle[k]) k = this.#fallback[k - 1] as number;
      if (this.#needle[i] === this.#needle[k]) k += 1;
      this.#fallback[i] = k;
    }
  }

  push(byte: number): void {
    this.#seen += 1;
    if (this.#window) {
      if (this.#window.length < this.#maxBytes) this.#window.push(byte);
      return;
    }
    if (this.#head.length < this.#maxBytes) this.#head.push(byte);
    if (this.#done || this.#needle.length === 0) return;
    const keep = EXCERPT_LEAD_BYTES + this.#needle.length;
    this.#recent.push(byte);
    if (this.#recent.length > 2 * keep) this.#recent = this.#recent.slice(-keep);
    const b = lower(byte);
    while (this.#matched > 0 && this.#needle[this.#matched] !== b)
      this.#matched = this.#fallback[this.#matched - 1] as number;
    if (this.#needle[this.#matched] === b) this.#matched += 1;
    if (this.#matched < this.#needle.length) return;
    // The first match. Near the start, the start of the line shows it; else a window does.
    if (this.#seen <= this.#maxBytes / 4) this.#done = true;
    else this.#window = this.#recent.slice(-keep);
  }

  /** The excerpt of the line pushed so far; the next line starts afresh. */
  take(): string {
    const window = this.#window;
    let bytes = window ?? this.#head;
    if (window) {
      // Not from the middle of a character.
      let start = 0;
      while (start < bytes.length && ((bytes[start] as number) & 0xc0) === 0x80) start += 1;
      bytes = bytes.slice(start);
    }
    const text = new TextDecoder().decode(Uint8Array.from(bytes)).replace(BROKEN_END, "");
    this.#head.length = 0;
    this.#recent = [];
    this.#window = null;
    this.#matched = 0;
    this.#seen = 0;
    this.#done = false;
    return window ? `${ELLIPSIS}${text.replace(BROKEN_START, "")}` : text;
  }
}
