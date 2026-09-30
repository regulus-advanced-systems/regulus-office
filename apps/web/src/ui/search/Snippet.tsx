/** A search snippet: server-provided segments, the matching ones in <mark>. Never HTML. */
import type { SnippetSegment } from "@regulus/protocol";

export function Snippet({ segments }: { segments: readonly SnippetSegment[] }) {
  return (
    <span className="rg-search__snippet">
      {segments.map((s, i) =>
        s.hit ? <mark key={i}>{s.text}</mark> : <span key={i}>{s.text}</span>,
      )}
    </span>
  );
}

/** Split `line` into segments where any of `terms` (lower-case) occurs. */
export function highlightTerms(line: string, terms: readonly string[]): SnippetSegment[] {
  const wanted = terms.filter(Boolean);
  if (wanted.length === 0) return [{ text: line, hit: false }];
  const lower = line.toLowerCase();
  const out: SnippetSegment[] = [];
  let at = 0;
  while (at < line.length) {
    let best = -1;
    let len = 0;
    for (const t of wanted) {
      const i = lower.indexOf(t, at);
      if (i >= 0 && (best < 0 || i < best || (i === best && t.length > len))) {
        best = i;
        len = t.length;
      }
    }
    if (best < 0) break;
    if (best > at) out.push({ text: line.slice(at, best), hit: false });
    out.push({ text: line.slice(best, best + len), hit: true });
    at = best + len;
  }
  if (at < line.length) out.push({ text: line.slice(at), hit: false });
  return out;
}
