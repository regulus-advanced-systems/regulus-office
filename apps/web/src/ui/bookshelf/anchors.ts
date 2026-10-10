/**
 * Heading anchors for the bookshelf reader (#264), the way GitHub names
 * them: lower case, punctuation dropped, spaces to hyphens, and `-1`, `-2`
 * for a repeated heading. A link's `#fragment` is compared the same way.
 *
 * The slug goes into a `data-` attribute, never an element id, so a
 * document's headings cannot shadow anything on `document` or `window`.
 */

export function headingSlug(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, "")
    .replace(/\s/g, "-");
}

/** Slugs for a document's headings in order; repeats get `-1`, `-2`, ... */
export function createSlugger(): (text: string) => string {
  const seen = new Map<string, number>();
  return (text) => {
    const base = headingSlug(text);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return n === 0 ? base : `${base}-${n}`;
  };
}

export const ANCHOR_ATTRIBUTE = "data-doc-anchor";

/** The heading a fragment names inside `root`, or null. */
export function findAnchor(root: ParentNode, fragment: string): Element | null {
  const wanted = fragment.toLowerCase();
  if (wanted === "") return null;
  for (const el of root.querySelectorAll(`[${ANCHOR_ATTRIBUTE}]`)) {
    if (el.getAttribute(ANCHOR_ATTRIBUTE) === wanted) return el;
  }
  return null;
}
