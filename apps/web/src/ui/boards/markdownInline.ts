/**
 * The inline half of the markdown parser (markdown.ts): emphasis, code
 * spans, links, images, autolinks and bare URLs inside one paragraph,
 * heading or table cell.
 *
 * The text is untrusted (an issue body, or a file anyone can push to a
 * repo, #264), so the scan must not be made slow on purpose. Two things
 * keep it linear in the length of the text:
 *
 * - **No rescanning.** Every forward search (the closing marker of an
 *   emphasis run, the end of a code span, the `]` of a link label, the end
 *   of a link target) goes through {@link Scan}, which remembers the last
 *   answer for each kind of search. A marker with no closer is found out
 *   once; the next one like it is given up at once. Links, autolinks and
 *   bare URLs are matched by hand instead of by regular expressions, whose
 *   cost on a failed match cannot be bounded or counted.
 * - **A work budget.** Every step is counted against a budget set from the
 *   length of the whole text ({@link newWork}). A text built to make the
 *   scan work hard anyway (link labels that nearly close, thousands of
 *   times) runs out; from there on the rest is shown as plain text. Plain
 *   text is always safe: the renderer escapes it.
 */
import { charge, newWork, Scan, type Work } from "./markdownScan.ts";

export { newWork, WORK_BASE, WORK_PER_CHAR, type Work } from "./markdownScan.ts";

export type Inline =
  | { t: "text"; v: string }
  | { t: "code"; v: string }
  | { t: "strong" | "em" | "del"; c: Inline[] }
  | { t: "link"; href: string; c: Inline[] }
  /** A relative link, as written (documents only). */
  | { t: "ref"; target: string; c: Inline[] }
  /** `src`: a relative image target, as written (documents only). */
  | { t: "image"; href: string | null; alt: string; src?: string }
  | { t: "br" };

export interface MarkdownOptions {
  /** Keep relative link and image targets (`ref`, `src`) instead of dropping them. */
  relative?: boolean;
  /** A single newline is a space, as in a document, not a line break, as in a comment. */
  softBreaks?: boolean;
  /** Parse pipe tables. */
  tables?: boolean;
  /** Text beyond this many characters is not parsed (default `MAX_MARKDOWN_CHARS`). */
  maxChars?: number;
}

export const COMMENT: Readonly<MarkdownOptions> = {};
export const MAX_DEPTH = 6;

/** A link target that is a relative path (or `#heading`), as text: no scheme, no host. */
function relativeTarget(raw: string): string | null {
  const target = raw.trim().replace(/^<|>$/g, "");
  if (target === "" || /[\u0000-\u001f\u007f\\]/.test(target)) return null;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(target) || target.startsWith("//")) return null;
  return target;
}

const SAFE_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

/** The URL if it is absolute http(s) or mailto, else null. */
export function safeUrl(raw: string): string | null {
  const href = raw.trim().replace(/^<|>$/g, "");
  // Control characters and whitespace inside a URL are how `java\tscript:` sneaks through.
  if (href === "" || /[\u0000- \u007f]/.test(href)) return null;
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  return SAFE_PROTOCOLS.has(url.protocol) ? url.href : null;
}

const ESCAPABLE = /^[\\`*_{}[\]()#+\-.!|~<>"'&]$/;

function pushText(out: Inline[], v: string): void {
  const last = out[out.length - 1];
  if (last?.t === "text") last.v += v;
  else out.push({ t: "text", v });
}

export function parseInline(
  s: string,
  depth = 0,
  opts: MarkdownOptions = COMMENT,
  work: Work = newWork(s.length),
): Inline[] {
  const out: Inline[] = [];
  const scan = new Scan(s, work);
  const inner = (text: string) => parseInline(text, depth + 1, opts, work);
  let i = 0;
  while (i < s.length) {
    if (work.left <= 0) {
      // Out of budget: what is left is shown as it was written.
      pushText(out, s.slice(i));
      break;
    }
    charge(work, 1);
    const ch = s[i] as string;
    if (ch === "\\" && ESCAPABLE.test(s[i + 1] ?? "")) {
      pushText(out, s[i + 1] as string);
      i += 2;
      continue;
    }
    if (ch === "\n") {
      if (opts.softBreaks) pushText(out, " ");
      else out.push({ t: "br" });
      i += 1;
      continue;
    }
    if (ch === "`") {
      let runEnd = i + 1;
      while (s[runEnd] === "`") runEnd += 1;
      const run = s.slice(i, runEnd);
      const end = scan.find(run, runEnd);
      if (end > 0) {
        out.push({ t: "code", v: s.slice(runEnd, end).trim() });
        i = end + run.length;
        continue;
      }
      pushText(out, run);
      i = runEnd;
      continue;
    }
    if (ch === "!" && s[i + 1] === "[") {
      const m = scan.link(i, true);
      if (m) {
        const href = safeUrl(m.target);
        const src = href || !opts.relative ? null : relativeTarget(m.target);
        out.push({
          t: "image",
          href,
          alt: m.label.replace(/\\(.)/g, "$1"),
          ...(src ? { src } : {}),
        });
        i = m.end;
        continue;
      }
    }
    if (ch === "[") {
      const m = scan.link(i, false);
      if (m) {
        const href = safeUrl(m.target);
        const label = depth < MAX_DEPTH ? inner(m.label) : [{ t: "text" as const, v: m.label }];
        const target = href || !opts.relative ? null : relativeTarget(m.target);
        if (href) out.push({ t: "link", href, c: label });
        else if (target) out.push({ t: "ref", target, c: label });
        else for (const node of label) node.t === "text" ? pushText(out, node.v) : out.push(node);
        i = m.end;
        continue;
      }
    }
    if (ch === "<") {
      const inside = scan.autolink(i);
      const href = inside ? safeUrl(inside) : null;
      if (inside && href) {
        out.push({ t: "link", href, c: [{ t: "text", v: inside }] });
        i += inside.length + 2;
        continue;
      }
    }
    if ((ch === "h" || ch === "H") && (i === 0 || /[\s(]/.test(s[i - 1] ?? ""))) {
      const found = scan.bareUrl(i);
      const href = found ? safeUrl(found) : null;
      if (found && href) {
        out.push({ t: "link", href, c: [{ t: "text", v: found }] });
        i += found.length;
        continue;
      }
    }
    const strongMarker = s.startsWith("**", i) ? "**" : s.startsWith("__", i) ? "__" : "";
    const intraword = ch === "_" && /\w/.test(s[i - 1] ?? "");
    if (strongMarker && !intraword && depth < MAX_DEPTH) {
      const end = scan.closing(strongMarker, i + 2);
      if (end > i + 2) {
        out.push({ t: "strong", c: inner(s.slice(i + 2, end)) });
        i = end + 2;
        continue;
      }
    }
    if (s.startsWith("~~", i) && depth < MAX_DEPTH) {
      const end = scan.closing("~~", i + 2);
      if (end > i + 2) {
        out.push({ t: "del", c: inner(s.slice(i + 2, end)) });
        i = end + 2;
        continue;
      }
    }
    if ((ch === "*" || ch === "_") && !intraword && depth < MAX_DEPTH && s[i + 1] !== " ") {
      const end = scan.closing(ch, i + 1);
      const after = s[end + 1] ?? "";
      if (end > i + 1 && !(ch === "_" && /\w/.test(after))) {
        out.push({ t: "em", c: inner(s.slice(i + 1, end)) });
        i = end + 1;
        continue;
      }
    }
    pushText(out, ch);
    i += 1;
  }
  return out;
}
