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
 *
 * The room's bookshelf (#264) reads whole documents from a repo with the
 * same parser and {@link DOCUMENT_MARKDOWN}: single newlines are spaces,
 * pipe tables are tables, and a relative link or image keeps its target as
 * written (`ref`, `src`) for the reader to resolve inside the repo's tree.
 * The target is still only text here; nothing in the tree is a URL the
 * parser did not pass through {@link safeUrl}.
 */
import {
  COMMENT,
  type Inline,
  MAX_DEPTH,
  type MarkdownOptions,
  newWork,
  parseInline,
  type Work,
} from "./markdownInline.ts";
import { type TableAlign, tableAt } from "./markdownTable.ts";

export {
  type Inline,
  type MarkdownOptions,
  newWork,
  parseInline,
  safeUrl,
  type Work,
} from "./markdownInline.ts";

export type Block =
  | { t: "p"; c: Inline[] }
  | { t: "h"; level: 1 | 2 | 3 | 4 | 5 | 6; c: Inline[] }
  | { t: "code"; lang: string; v: string }
  | { t: "quote"; c: Block[] }
  | { t: "list"; ordered: boolean; start: number; items: ListItem[] }
  | { t: "table"; align: TableAlign[]; head: Inline[][]; rows: Inline[][][] }
  | { t: "hr" };

export interface ListItem {
  /** `null` for a plain item, else a task list checkbox state. */
  checked: boolean | null;
  c: Block[];
}

export const MAX_MARKDOWN_CHARS = 65_536;
/** How a repo's document is parsed (#264). */
export const DOCUMENT_MARKDOWN: Readonly<MarkdownOptions> = {
  relative: true,
  softBreaks: true,
  tables: true,
  maxChars: 600_000,
};
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

function parseLines(lines: string[], depth: number, opts: MarkdownOptions, work: Work): Block[] {
  const inline = (s: string) => parseInline(s, 0, opts, work);
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
      blocks.push({ t: "h", level, c: inline(heading[2] ?? "") });
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
          ? { t: "quote", c: parseLines(body, depth + 1, opts, work) }
          : { t: "p", c: inline(body.join("\n")) },
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
              ? parseLines(body, depth + 1, opts, work)
              : [{ t: "p", c: inline(body.join("\n")) }],
        });
      }
      blocks.push(list);
      continue;
    }
    const table = opts.tables ? tableAt(lines, i) : null;
    if (table) {
      blocks.push({
        t: "table",
        align: table.align,
        head: table.head.map(inline),
        rows: table.rows.map((row) => row.map(inline)),
      });
      i = table.next;
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && !isBlank(lines[i] as string)) {
      if (para.length > 0 && startsBlock(lines[i] as string)) break;
      if (para.length > 0 && opts.tables && tableAt(lines, i)) break;
      para.push((lines[i] as string).trim());
      i += 1;
    }
    blocks.push({ t: "p", c: inline(para.join("\n")) });
  }
  return blocks;
}

/**
 * Parse a markdown document; HTML comments are removed, text is capped, and
 * the inline scan works within a budget set from the length (markdownInline.ts).
 */
export function parseMarkdown(
  source: string,
  opts: MarkdownOptions = COMMENT,
  work?: Work,
): Block[] {
  const text = source
    .slice(0, opts.maxChars ?? MAX_MARKDOWN_CHARS)
    .replace(/\r\n?/g, "\n")
    .replace(/<!--[\s\S]*?(?:-->|$)/g, "");
  return parseLines(text.split("\n"), 0, opts, work ?? newWork(text.length));
}
