/**
 * The parser's document mode (#264) and what stays as it was for issue and
 * PR bodies: comments never gain tables, relative targets or soft breaks.
 */
import { describe, expect, test } from "bun:test";
import { DOCUMENT_MARKDOWN, parseInline, parseMarkdown } from "./markdown.ts";
import { MAX_TABLE_ROWS, splitRow, tableAt } from "./markdownTable.ts";

describe("comments (the default) are unchanged", () => {
  test("relative links are their label, tables are text, newlines are breaks", () => {
    expect(parseInline("[up](../x.md) ![i](a.png)")).toEqual([
      { t: "text", v: "up " },
      { t: "image", href: null, alt: "i" },
    ]);
    expect(parseMarkdown("| a |\n| - |\n| b |")).toEqual([
      {
        t: "p",
        c: [
          { t: "text", v: "| a |" },
          { t: "br" },
          { t: "text", v: "| - |" },
          { t: "br" },
          { t: "text", v: "| b |" },
        ],
      },
    ]);
  });
});

describe("documents", () => {
  const inline = (s: string) => parseInline(s, 0, DOCUMENT_MARKDOWN);

  test("relative targets are kept as written; anything with a scheme or a host is not relative", () => {
    expect(inline("[a](../x.md#h) ![i](img/a.png)")).toEqual([
      { t: "ref", target: "../x.md#h", c: [{ t: "text", v: "a" }] },
      { t: "text", v: " " },
      { t: "image", href: null, alt: "i", src: "img/a.png" },
    ]);
    for (const bad of ["javascript:alert`1`", "data:text/html,x", "//evil.example/x", "a\\b"]) {
      expect(inline(`[a](${bad})`)).toEqual([{ t: "text", v: "a" }]);
      expect(inline(`![a](${bad})`)).toEqual([{ t: "image", href: null, alt: "a" }]);
    }
    expect(inline("[a](https://example.com/x)")).toEqual([
      { t: "link", href: "https://example.com/x", c: [{ t: "text", v: "a" }] },
    ]);
  });

  test("a table needs a header, a matching delimiter row, and ends at a blank line", () => {
    const blocks = parseMarkdown(
      "intro\n| a | b |\n|:--|--:|\n| 1 | 2 |\n| 3 |\n\nafter",
      DOCUMENT_MARKDOWN,
    );
    expect(blocks.map((b) => b.t)).toEqual(["p", "table", "p"]);
    const table = blocks[1];
    if (table?.t !== "table") throw new Error("no table");
    expect(table.align).toEqual(["left", "right"]);
    expect(table.rows).toEqual([
      [[{ t: "text", v: "1" }], [{ t: "text", v: "2" }]],
      [[{ t: "text", v: "3" }], []],
    ]);
    // Not tables: no delimiter row, or a different number of cells.
    expect(tableAt(["| a | b |", "| 1 | 2 |"], 0)).toBeNull();
    expect(tableAt(["| a | b |", "| --- |"], 0)).toBeNull();
    expect(tableAt(["a - b", "-----"], 0)).toBeNull();
    expect(splitRow("| `a|b` | c \\| d |")).toEqual(["`a|b`", "c | d"]);
  });

  test("a table without end stops at the row cap", () => {
    const lines = ["| a |", "| - |", ...Array.from({ length: MAX_TABLE_ROWS + 50 }, () => "| x |")];
    expect(tableAt(lines, 0)?.rows).toHaveLength(MAX_TABLE_ROWS);
  });

  test("documents longer than a comment's cap are read whole", () => {
    const blocks = parseMarkdown(`${"word ".repeat(20_000)}\n\n# End`, DOCUMENT_MARKDOWN);
    expect(blocks.at(-1)).toEqual({ t: "h", level: 1, c: [{ t: "text", v: "End" }] });
  });
});
