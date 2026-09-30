/**
 * User input → SQLite FTS5 MATCH expression (#41).
 *
 * Nothing the user types is ever FTS5 syntax: the query is split into words
 * (runs of letters, digits and `_`, the same characters the unicode61
 * tokenizer keeps) and "quoted phrases", each becomes a double-quoted FTS5
 * string, and the strings are ANDed. `AND`/`OR`/`NOT`/`NEAR`, column filters
 * (`body:`), `^`, `*`, `+`, parentheses and stray quotes are therefore plain
 * text. The last bare word gets a prefix match (`"word"*`) so results appear
 * while typing. Length and term count are capped.
 */
import { SEARCH_QUERY_MAX, SEARCH_TERMS_MAX } from "@regulus/protocol";

/** Longest single term kept (characters). */
export const TERM_MAX = 64;

export interface ParsedQuery {
  /** The FTS5 MATCH expression. */
  match: string;
  /** The words searched for, lower-cased, for highlighting on the client. */
  terms: string[];
}

const WORD = /[\p{L}\p{N}_]+/gu;

function words(text: string): string[] {
  return (text.match(WORD) ?? []).map((w) => w.slice(0, TERM_MAX));
}

/** An FTS5 string literal: double quotes inside are doubled. */
export function ftsString(text: string): string {
  return `"${text.replace(/"/g, '""')}"`;
}

/** Parse a search box value; null when there is nothing to search for. */
export function parseSearchQuery(raw: string): ParsedQuery | null {
  const input = raw.normalize("NFKC").slice(0, SEARCH_QUERY_MAX);
  const parts: { words: string[]; phrase: boolean }[] = [];
  // Balanced "..." are phrases; everything else (an unbalanced quote included) is loose words.
  const phrase = /"([^"]*)"/g;
  let last = 0;
  for (const m of input.matchAll(phrase)) {
    const before = words(input.slice(last, m.index));
    for (const w of before) parts.push({ words: [w], phrase: false });
    const inside = words(m[1] ?? "");
    if (inside.length) parts.push({ words: inside, phrase: true });
    last = (m.index ?? 0) + m[0].length;
  }
  for (const w of words(input.slice(last))) parts.push({ words: [w], phrase: false });

  const kept = parts.slice(0, SEARCH_TERMS_MAX);
  if (kept.length === 0) return null;
  const lastPart = kept.at(-1);
  const exprs = kept.map((p) => {
    const lit = ftsString(p.words.join(" "));
    // Prefix-match the word being typed; a one-letter prefix would match half the index.
    const prefix = p === lastPart && !p.phrase && (p.words[0]?.length ?? 0) >= 2;
    return prefix ? `${lit}*` : lit;
  });
  const terms = [...new Set(kept.flatMap((p) => p.words.map((w) => w.toLowerCase())))];
  return { match: exprs.join(" AND "), terms };
}
