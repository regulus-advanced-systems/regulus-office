/**
 * The searches of the inline markdown scan (markdownInline.ts) and the work
 * budget they are counted against. The text is untrusted, so no search may
 * be repeated over the same ground:
 *
 * - `find` and `next` remember their last answer: a search from `from` that
 *   found its match at `at` (or nothing) answers every later search of the
 *   same kind that starts between the two.
 * - `closing` and the link label write the answer down for every position
 *   they pass, so each position is walked once per kind of search.
 * - Links, autolinks and bare URLs are matched by hand, not by regular
 *   expressions, whose cost on a failed match can be neither bounded nor
 *   counted.
 *
 * Every step is charged to a `Work` budget set from the length of the whole
 * text; markdownInline.ts stops parsing when it runs out.
 */

/** Steps the inline scan may take: so many per character of the text, plus a floor. */
export const WORK_PER_CHAR = 8;
export const WORK_BASE = 20_000;
/** Longest link target or title, and URL, the scan will match, characters. */
export const TARGET_MAX = 2000;
export const URL_MAX = 2000;

/** What is left of the budget, and what was spent (tests read `spent`). */
export interface Work {
  left: number;
  spent: number;
}

export function newWork(chars: number, perChar = WORK_PER_CHAR): Work {
  return { left: WORK_BASE + perChar * chars, spent: 0 };
}

export function charge(work: Work, steps: number): void {
  work.left -= steps;
  work.spent += steps;
}
const LABEL_STOP = /[[\]\\]/g;
const TARGET_STOP = /[)\s]/g;
const AUTOLINK_STOP = /[>\s]/g;
const URL_STOP = /[\s<>"]/g;
const SPACES = /\s*/y;
/** Not yet worked out (a closer is an index or -1). */
const UNKNOWN = -2;
const AUTOLINK_START = /^(?:https?:\/\/|mailto:)/i;
const URL_START = /^https?:\/\//i;
const URL_TRAILING = /['.,:;!?)\]]/;
/** What `.` does not match in a regular expression. */
const isLineEnd = (c: string) =>
  c === "\n" || c === "\r" || c.charCodeAt(0) === 0x2028 || c.charCodeAt(0) === 0x2029;

export interface LinkMatch {
  label: string;
  target: string;
  /** Index after the closing `)`. */
  end: number;
}

/**
 * Forward searches in one string, each remembering its last answer: a
 * search from `from` that found its match at `at` (or nothing) answers
 * every later search of the same kind that starts between the two.
 */
export class Scan {
  readonly #memo = new Map<string, readonly [from: number, at: number]>();

  constructor(
    readonly s: string,
    readonly work: Work,
  ) {}

  #known(key: string, from: number): number | undefined {
    const m = this.#memo.get(key);
    if (!m || m[0] > from) return undefined;
    if (m[1] < 0) return -1;
    return m[1] >= from ? m[1] : undefined;
  }

  #learn(key: string, from: number, at: number): number {
    charge(this.work, (at < 0 ? this.s.length : at) - from + 1);
    this.#memo.set(key, [from, at]);
    return at;
  }

  /** `indexOf`, remembered. */
  find(needle: string, from: number): number {
    return this.#known(needle, from) ?? this.#learn(needle, from, this.s.indexOf(needle, from));
  }

  /** First index at or after `from` of a character `stop` (a global regex) matches, or -1. */
  next(stop: RegExp, from: number): number {
    const known = this.#known(stop.source, from);
    if (known !== undefined) return known;
    stop.lastIndex = from;
    return this.#learn(stop.source, from, stop.exec(this.s)?.index ?? -1);
  }

  /** Index after any whitespace at `from`. */
  spaces(from: number): number {
    SPACES.lastIndex = from;
    SPACES.exec(this.s);
    charge(this.work, SPACES.lastIndex - from + 1);
    return SPACES.lastIndex;
  }

  /** Where the emphasis scan goes from `at` when it skips: past `\x`, past a code span; else -1. */
  #skip(at: number): number {
    const { s } = this;
    if (s[at] === "\\") return at + 2;
    if (s[at] === "`") {
      const end = this.find("`", at + 1);
      if (end > 0) return end + 1;
    }
    return -1;
  }

  readonly #closers = new Map<string, Int32Array>();

  /**
   * Index of the closing `marker` for an emphasis run starting at `from`, or
   * -1: the first place after `from`, stepping over escapes and code spans,
   * where the marker stands after something other than a space.
   *
   * Where the scan goes next depends only on where it is, so the answer for
   * a position is the same whichever run asked: it is written down for every
   * position a scan passes, and a later scan stops at the first one it
   * finds answered. Each position is walked once per marker.
   */
  closing(marker: string, from: number): number {
    const { s } = this;
    let answers = this.#closers.get(marker);
    if (!answers) {
      answers = new Int32Array(s.length + 2).fill(UNKNOWN);
      this.#closers.set(marker, answers);
    }
    const skipped = this.#skip(from);
    let at = skipped < 0 ? from + 1 : skipped;
    const passed: number[] = [];
    let answer = -1;
    while (at < s.length) {
      const known = answers[at] as number;
      if (known !== UNKNOWN) {
        answer = known;
        break;
      }
      const skip = this.#skip(at);
      if (skip < 0 && s.startsWith(marker, at) && s[at - 1] !== " ") {
        answer = at;
        break;
      }
      passed.push(at);
      at = skip < 0 ? at + 1 : skip;
    }
    for (const p of passed) answers[p] = answer;
    charge(this.work, passed.length + 1);
    return answer;
  }

  /**
   * The `]` that ends a link label starting at `from`: plain characters,
   * `\x` escapes and, in a link (not an image), one level of `[...]`.
   */
  #labelEnd(from: number, nested: boolean): number {
    const { s } = this;
    // As with `closing`: the answer for a position is the same for every label that passes it.
    const key = nested ? "label" : "alt";
    let answers = this.#closers.get(key);
    if (!answers) {
      answers = new Int32Array(s.length + 3).fill(UNKNOWN);
      this.#closers.set(key, answers);
    }
    const passed: number[] = [];
    let answer = -1;
    let i = from;
    for (;;) {
      const known = answers[i] as number;
      if (known !== UNKNOWN) {
        answer = known;
        break;
      }
      passed.push(i);
      const at = this.next(LABEL_STOP, i);
      if (at < 0) break;
      if (s[at] === "]") {
        answer = at;
        break;
      }
      if (s[at] === "\\") {
        const escaped = s[at + 1];
        if (escaped === undefined || isLineEnd(escaped)) break;
        i = at + 2;
        continue;
      }
      if (!nested) break;
      const close = this.find("]", at + 1);
      if (close < 0) break;
      i = close + 1;
    }
    for (const p of passed) answers[p] = answer;
    charge(this.work, passed.length + 1);
    return answer;
  }

  /** After a target ending at `at`: an optional quoted title, then `)`. Index after it, or -1. */
  #closeParen(at: number): number {
    const { s } = this;
    const gap = this.spaces(at);
    const quote = s[gap];
    if (gap > at && (quote === '"' || quote === "'")) {
      const end = this.find(quote, gap + 1);
      if (end >= 0 && end - gap <= TARGET_MAX) {
        const after = this.spaces(end + 1);
        if (s[after] === ")") return after + 1;
      }
    }
    return s[gap] === ")" ? gap + 1 : -1;
  }

  /**
   * `[label](target "title")` at `at` (`![alt](...)` with `image`), as the
   * expressions this replaces matched it: the target is `<...>` or runs to
   * the first `)` or whitespace.
   */
  link(at: number, image: boolean): LinkMatch | null {
    const { s } = this;
    const labelFrom = at + (image ? 2 : 1);
    const labelEnd = this.#labelEnd(labelFrom, !image);
    if (labelEnd < 0 || s[labelEnd + 1] !== "(") return null;
    const from = this.spaces(labelEnd + 2);
    const label = s.slice(labelFrom, labelEnd);
    if (s[from] === "<") {
      const gt = this.find(">", from + 1);
      if (gt >= 0 && gt - from <= TARGET_MAX) {
        const end = this.#closeParen(gt + 1);
        if (end >= 0) return { label, target: s.slice(from, gt + 1), end };
      }
    }
    const stop = this.next(TARGET_STOP, from);
    const targetEnd = stop < 0 ? s.length : stop;
    if (targetEnd - from > TARGET_MAX) return null;
    const end = this.#closeParen(targetEnd);
    if (end >= 0) return { label, target: s.slice(from, targetEnd), end };
    // `( "only a title")`: no target, and the spaces before it belong to the title.
    const bare = from > labelEnd + 2 ? this.#closeParen(labelEnd + 2) : -1;
    return bare >= 0 ? { label, target: "", end: bare } : null;
  }

  /** `<https://...>` or `<mailto:...>` at `at`: the URL inside, or null. */
  autolink(at: number): string | null {
    const { s } = this;
    const start = AUTOLINK_START.exec(s.slice(at + 1, at + 10));
    if (!start) return null;
    const from = at + 1 + start[0].length;
    const stop = this.next(AUTOLINK_STOP, from);
    if (stop <= from || s[stop] !== ">" || stop - at > URL_MAX) return null;
    return s.slice(at + 1, stop);
  }

  /** A bare `http(s)://` URL at `at`, without trailing punctuation, or null. */
  bareUrl(at: number): string | null {
    const { s } = this;
    const start = URL_START.exec(s.slice(at, at + 8));
    if (!start) return null;
    const from = at + start[0].length;
    const stop = this.next(URL_STOP, from);
    let end = Math.min(stop < 0 ? s.length : stop, at + URL_MAX);
    while (end > from && URL_TRAILING.test(s[end - 1] as string)) end -= 1;
    charge(this.work, 1);
    return end > from ? s.slice(at, end) : null;
  }
}
