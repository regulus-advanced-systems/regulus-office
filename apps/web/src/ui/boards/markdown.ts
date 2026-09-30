/**
 * A small GitHub-flavoured markdown parser for issue and PR bodies and
 * comments (#36). It produces a tree that `Markdown.tsx` turns into React
 * elements, so nothing is ever set as HTML:
 *
 * - Raw HTML stays literal text; HTML comments (PR templates) are dropped,
 *   as GitHub hides them too.
 * - Links keep only `http:`, `https:` and `mailto:` targets ({@link safeUrl});
 *   anything else (`javascript:`, `data:`, relative paths) becomes plain text.
 * - Images are never loaded (no image proxy): they become a link to the
 *   image, labelled with its alt text.
 *
 * Covered: headings, paragraphs (single newlines are line breaks, like
 * GitHub comments), fenced code, block quotes, bullet / numbered / task
 * lists, rules, inline code, bold, italic, strikethrough, links, autolinks.
 * Tables and other extensions show as their source text.
 */

export type Inline =
  | { t: "text"; v: string }
  | { t: "code"; v: string }
  | { t: "strong" | "em" | "del"; c: Inline[] }
  | { t: "link"; href: string; c: Inline[] }
  | { t: "image"; href: string | null; alt: string }
  | { t: "br" };

export type Block =
  | { t: "p"; c: Inline[] }
  | { t: "h"; level: 1 | 2 | 3 | 4 | 5 | 6; c: Inline[] }
  | { t: "code"; lang: string; v: string }
  | { t: "quote"; c: Block[] }
  | { t: "list"; ordered: boolean; start: number; items: ListItem[] }
  | { t: "hr" };

export interface ListItem {
  /** `null` for a plain item, else a task list checkbox state. */
  checked: boolean | null;
  c: Block[];
}

export const MAX_MARKDOWN_CHARS = 65_536;
const MAX_DEPTH = 6;

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

// ---- Inline ------------------------------------------------------------------

const ESCAPABLE = /^[\\`*_{}[\]()#+\-.!|~<>"'&]/;
const LINK =
  /^\[((?:[^[\]\\]|\\.|\[[^\]]*\])*)\]\(\s*(<[^>]*>|[^)\s]*)(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/;
const IMAGE = /^!\[((?:[^[\]\\]|\\.)*)\]\(\s*(<[^>]*>|[^)\s]*)(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/;
const AUTOLINK = /^<((?:https?:\/\/|mailto:)[^>\s]+)>/i;
const BARE_URL = /^https?:\/\/[^\s<>"]*[^\s<>"'.,:;!?)\]]/i;

function pushText(out: Inline[], v: string): void {
  const last = out[out.length - 1];
  if (last?.t === "text") last.v += v;
  else out.push({ t: "text", v });
}

/** Index of the closing `marker` for an emphasis run starting at `from`, or -1. */
function closing(s: string, marker: string, from: number): number {
  let i = from;
  while (i < s.length) {
    if (s[i] === "\\") {
      i += 2;
      continue;
    }
    if (s[i] === "`") {
      const end = s.indexOf("`", i + 1);
      if (end > 0) {
        i = end + 1;
        continue;
      }
    }
    if (s.startsWith(marker, i) && i > from && s[i - 1] !== " ") return i;
    i += 1;
  }
  return -1;
}

export function parseInline(s: string, depth = 0): Inline[] {
  const out: Inline[] = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i] as string;
    const rest = s.slice(i);
    if (ch === "\\" && ESCAPABLE.test(s.slice(i + 1))) {
      pushText(out, s[i + 1] as string);
      i += 2;
      continue;
    }
    if (ch === "\n") {
      out.push({ t: "br" });
      i += 1;
      continue;
    }
    if (ch === "`") {
      const run = /^`+/.exec(rest)?.[0] ?? "`";
      const end = s.indexOf(run, i + run.length);
      if (end > 0) {
        out.push({ t: "code", v: s.slice(i + run.length, end).trim() });
        i = end + run.length;
        continue;
      }
      pushText(out, run);
      i += run.length;
      continue;
    }
    if (ch === "!" && s[i + 1] === "[") {
      const m = IMAGE.exec(rest);
      if (m) {
        out.push({
          t: "image",
          href: safeUrl(m[2] ?? ""),
          alt: (m[1] ?? "").replace(/\\(.)/g, "$1"),
        });
        i += m[0].length;
        continue;
      }
    }
    if (ch === "[") {
      const m = LINK.exec(rest);
      if (m) {
        const href = safeUrl(m[2] ?? "");
        const label =
          depth < MAX_DEPTH
            ? parseInline(m[1] ?? "", depth + 1)
            : [{ t: "text" as const, v: m[1] ?? "" }];
        if (href) out.push({ t: "link", href, c: label });
        else for (const node of label) node.t === "text" ? pushText(out, node.v) : out.push(node);
        i += m[0].length;
        continue;
      }
    }
    if (ch === "<") {
      const m = AUTOLINK.exec(rest);
      const href = m ? safeUrl(m[1] ?? "") : null;
      if (m && href) {
        out.push({ t: "link", href, c: [{ t: "text", v: m[1] ?? "" }] });
        i += m[0].length;
        continue;
      }
    }
    if ((ch === "h" || ch === "H") && (i === 0 || /[\s(]/.test(s[i - 1] ?? ""))) {
      const m = BARE_URL.exec(rest);
      const href = m ? safeUrl(m[0]) : null;
      if (m && href) {
        out.push({ t: "link", href, c: [{ t: "text", v: m[0] }] });
        i += m[0].length;
        continue;
      }
    }
    const strongMarker = rest.startsWith("**") ? "**" : rest.startsWith("__") ? "__" : "";
    const intraword = ch === "_" && /\w/.test(s[i - 1] ?? "");
    if (strongMarker && !intraword && depth < MAX_DEPTH) {
      const end = closing(s, strongMarker, i + 2);
      if (end > i + 2) {
        out.push({ t: "strong", c: parseInline(s.slice(i + 2, end), depth + 1) });
        i = end + 2;
        continue;
      }
    }
    if (rest.startsWith("~~") && depth < MAX_DEPTH) {
      const end = closing(s, "~~", i + 2);
      if (end > i + 2) {
        out.push({ t: "del", c: parseInline(s.slice(i + 2, end), depth + 1) });
        i = end + 2;
        continue;
      }
    }
    if ((ch === "*" || ch === "_") && !intraword && depth < MAX_DEPTH && s[i + 1] !== " ") {
      const end = closing(s, ch, i + 1);
      const after = s[end + 1] ?? "";
      if (end > i + 1 && !(ch === "_" && /\w/.test(after))) {
        out.push({ t: "em", c: parseInline(s.slice(i + 1, end), depth + 1) });
        i = end + 1;
        continue;
      }
    }
    pushText(out, ch);
    i += 1;
  }
  return out;
}

// ---- Blocks ------------------------------------------------------------------

const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([\w+#.-]*)/;
const HEADING = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const RULE = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/;
const QUOTE = /^ {0,3}>\s?/;
const ITEM = /^( {0,3})([-*+]|(\d{1,9})[.)])\s+(.*)$/;
const TASK = /^\[([ xX])\]\s+/;

const isBlank = (line: string) => line.trim() === "";

function startsBlock(line: string): boolean {
  return (
    FENCE.test(line) || HEADING.test(line) || RULE.test(line) || QUOTE.test(line) || ITEM.test(line)
  );
}

function parseLines(lines: string[], depth: number): Block[] {
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] as string;
    if (isBlank(line)) {
      i += 1;
      continue;
    }
    const fence = FENCE.exec(line);
    if (fence) {
      const marker = fence[1] as string;
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !(lines[i] as string).trimStart().startsWith(marker)) {
        body.push(lines[i] as string);
        i += 1;
      }
      i += 1; // closing fence (or end of text)
      blocks.push({ t: "code", lang: fence[2] ?? "", v: body.join("\n") });
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      const level = (heading[1] as string).length as 1 | 2 | 3 | 4 | 5 | 6;
      blocks.push({ t: "h", level, c: parseInline(heading[2] ?? "") });
      i += 1;
      continue;
    }
    if (RULE.test(line)) {
      blocks.push({ t: "hr" });
      i += 1;
      continue;
    }
    if (QUOTE.test(line)) {
      const body: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i] as string)) {
        body.push((lines[i] as string).replace(QUOTE, ""));
        i += 1;
      }
      blocks.push(
        depth < MAX_DEPTH
          ? { t: "quote", c: parseLines(body, depth + 1) }
          : { t: "p", c: parseInline(body.join("\n")) },
      );
      continue;
    }
    const item = ITEM.exec(line);
    if (item) {
      const ordered = item[3] !== undefined;
      const list: Block & { t: "list" } = {
        t: "list",
        ordered,
        start: ordered ? Number(item[3]) : 1,
        items: [],
      };
      while (i < lines.length) {
        const m = ITEM.exec(lines[i] as string);
        if (!m || (m[3] !== undefined) !== ordered) break;
        const indent = (m[1] as string).length + (m[2] as string).length + 1;
        const body = [m[4] ?? ""];
        i += 1;
        // Continuation: indented lines (nested lists, wrapped text), blank lines between them.
        while (i < lines.length) {
          const next = lines[i] as string;
          if (isBlank(next)) {
            const after = lines[i + 1];
            if (after !== undefined && /^\s{2,}\S/.test(after)) {
              body.push("");
              i += 1;
              continue;
            }
            break;
          }
          if (/^\s{2,}\S/.test(next)) body.push(next.slice(Math.min(indent, next.search(/\S/))));
          else if (!startsBlock(next)) body.push(next);
          else break;
          i += 1;
        }
        const task = TASK.exec(body[0] ?? "");
        if (task) body[0] = (body[0] ?? "").slice(task[0].length);
        list.items.push({
          checked: task ? task[1] !== " " : null,
          c:
            depth < MAX_DEPTH
              ? parseLines(body, depth + 1)
              : [{ t: "p", c: parseInline(body.join("\n")) }],
        });
      }
      blocks.push(list);
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && !isBlank(lines[i] as string)) {
      if (para.length > 0 && startsBlock(lines[i] as string)) break;
      para.push((lines[i] as string).trim());
      i += 1;
    }
    blocks.push({ t: "p", c: parseInline(para.join("\n")) });
  }
  return blocks;
}

/** Parse a markdown document; HTML comments are removed, text is capped. */
export function parseMarkdown(source: string): Block[] {
  const text = source
    .slice(0, MAX_MARKDOWN_CHARS)
    .replace(/\r\n?/g, "\n")
    .replace(/<!--[\s\S]*?(?:-->|$)/g, "");
  return parseLines(text.split("\n"), 0);
}
