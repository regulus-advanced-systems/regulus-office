/**
 * A plain line diff (#136): what changed between two versions of a text, for
 * the history of an agent's soul. The server uses the counts for the audit
 * log (how big an edit was, never what it said); the browser shows the lines.
 */

export interface TextDiffLine {
  /** `same`: in both; `add`: only in the new text; `del`: only in the old one. */
  t: "same" | "add" | "del";
  line: string;
}

export interface TextDiffStat {
  added: number;
  removed: number;
}

const linesOf = (text: string): string[] => (text === "" ? [] : text.split("\n"));

/** Above this many cells the table is not built; the diff is then "all removed, all added". */
const MAX_CELLS = 4_000_000;

/** Longest-common-subsequence diff by line. */
export function lineDiff(before: string, after: string): TextDiffLine[] {
  const a = linesOf(before);
  const b = linesOf(after);
  // Lines both texts start and end with need no table.
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (
    tail < a.length - head &&
    tail < b.length - head &&
    a[a.length - 1 - tail] === b[b.length - 1 - tail]
  ) {
    tail++;
  }
  const am = a.slice(head, a.length - tail);
  const bm = b.slice(head, b.length - tail);
  const out: TextDiffLine[] = a.slice(0, head).map((line) => ({ t: "same", line }));
  if (am.length * bm.length > MAX_CELLS) {
    for (const line of am) out.push({ t: "del", line });
    for (const line of bm) out.push({ t: "add", line });
  } else {
    const w = bm.length + 1;
    // lcs[i * w + j]: length of the LCS of am[i..] and bm[j..].
    const lcs = new Uint32Array((am.length + 1) * w);
    for (let i = am.length - 1; i >= 0; i--) {
      for (let j = bm.length - 1; j >= 0; j--) {
        lcs[i * w + j] =
          am[i] === bm[j]
            ? (lcs[(i + 1) * w + j + 1] ?? 0) + 1
            : Math.max(lcs[(i + 1) * w + j] ?? 0, lcs[i * w + j + 1] ?? 0);
      }
    }
    let i = 0;
    let j = 0;
    while (i < am.length && j < bm.length) {
      if (am[i] === bm[j]) {
        out.push({ t: "same", line: am[i] ?? "" });
        i++;
        j++;
      } else if ((lcs[(i + 1) * w + j] ?? 0) >= (lcs[i * w + j + 1] ?? 0)) {
        out.push({ t: "del", line: am[i++] ?? "" });
      } else {
        out.push({ t: "add", line: bm[j++] ?? "" });
      }
    }
    while (i < am.length) out.push({ t: "del", line: am[i++] ?? "" });
    while (j < bm.length) out.push({ t: "add", line: bm[j++] ?? "" });
  }
  for (const line of a.slice(a.length - tail)) out.push({ t: "same", line });
  return out;
}

export function diffStat(before: string, after: string): TextDiffStat {
  let added = 0;
  let removed = 0;
  for (const d of lineDiff(before, after)) {
    if (d.t === "add") added++;
    else if (d.t === "del") removed++;
  }
  return { added, removed };
}
