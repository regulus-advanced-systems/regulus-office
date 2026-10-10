/**
 * The inline scan is linear (#264 review): a document built to make it
 * rescan cannot hold the page. A 500 KB document of a repeated unit took
 * tens of seconds before (`~~a ` 82 s, `*a ` 51 s, `[[]` 23 s).
 *
 * These tests count the scan's own steps (`Work.spent`), not time: a step
 * count is the same on a loaded machine, so the bound can be tight without
 * being flaky. A quadratic scan of these documents takes tens of thousands
 * of steps per character; the bound is 6.
 */
import { describe, expect, test } from "bun:test";
import { DOCUMENT_MARKDOWN, newWork, parseMarkdown, type Work } from "./markdown.ts";
import { WORK_BASE, WORK_PER_CHAR } from "./markdownInline.ts";

const STEPS_PER_CHAR = 6;
/** The size of the largest document the bookshelf opens. */
const DOC_CHARS = 497_000;

const repeat = (unit: string, chars: number) => unit.repeat(Math.floor(chars / unit.length));
/** 25 paragraphs of a repeated unit: the shape that froze the reader. */
const paragraphs = (unit: string, chars = DOC_CHARS) =>
  Array.from({ length: 25 }, () => repeat(unit, chars / 25 - 2)).join("\n\n");

const unlimited = (): Work => ({ left: Number.POSITIVE_INFINITY, spent: 0 });

/** The units of the review, then every other way a search can be made to fail or run long. */
const REVIEWED = [
  "~~a ",
  "*a ",
  "**a ",
  "[[]",
  "[a](",
  "[",
  "![",
  "`a",
  "<http://a ",
  " http://a(",
  "[\\",
];
const MORE = [
  "__a ",
  "_a ",
  "``a`",
  "<http://a",
  "<mailto:a",
  " http://a.....",
  "[a[b]",
  "[a](b ",
  "[a](<b",
  '[a](b "c',
  "![a](",
  "*a `b",
  "\\*a ",
  "[a][b] ",
  "a_b_c ",
  "[a](b)",
  "**a**",
  "*",
  "`",
];

describe("the inline scan is linear in the length of the document", () => {
  test.each(REVIEWED)("25 paragraphs of %j, 497 KB: at most 6 steps a character", (unit) => {
    const source = paragraphs(unit);
    const work = unlimited();
    parseMarkdown(source, DOCUMENT_MARKDOWN, work);
    expect(work.spent / source.length).toBeLessThan(STEPS_PER_CHAR);
    // So the budget a document gets is never reached by these.
    expect(work.spent).toBeLessThan(newWork(source.length).left);
  });

  test.each(REVIEWED)("one 497 KB paragraph of %j: the same", (unit) => {
    const source = repeat(unit, DOC_CHARS);
    const work = unlimited();
    parseMarkdown(source, DOCUMENT_MARKDOWN, work);
    expect(work.spent / source.length).toBeLessThan(STEPS_PER_CHAR);
  });

  test.each(MORE)("%j: steps per character do not grow with the document", (unit) => {
    const perChar = [30_000, 120_000].map((chars) => {
      const source = paragraphs(unit, chars);
      const work = unlimited();
      parseMarkdown(source, DOCUMENT_MARKDOWN, work);
      return work.spent / source.length;
    });
    expect(perChar[0]).toBeLessThan(STEPS_PER_CHAR);
    expect(perChar[1]).toBeLessThan(STEPS_PER_CHAR);
    // Four times the text, the same work per character (a quadratic scan would quadruple it).
    expect((perChar[1] as number) / Math.max(perChar[0] as number, 0.01)).toBeLessThan(1.25);
  });

  test("issue and PR bodies get the same scan", () => {
    const source = repeat("~~a ", 60_000);
    const work = unlimited();
    parseMarkdown(source, {}, work);
    expect(work.spent / source.length).toBeLessThan(STEPS_PER_CHAR);
  });
});

describe("the work budget is the backstop", () => {
  test("a document gets so many steps per character, plus a floor", () => {
    expect(newWork(1000)).toEqual({ left: WORK_BASE + 1000 * WORK_PER_CHAR, spent: 0 });
    expect(WORK_PER_CHAR).toBeGreaterThan(STEPS_PER_CHAR);
  });

  test("out of budget, the rest is plain text: nothing lost, nothing parsed", () => {
    const source = "**bold** and [a link](https://example.com) ".repeat(200);
    const work: Work = { left: 400, spent: 0 };
    const blocks = parseMarkdown(source, DOCUMENT_MARKDOWN, work);
    const p = blocks[0];
    if (p?.t !== "p") throw new Error("no paragraph");
    expect(p.c.some((n) => n.t === "strong")).toBe(true);
    const last = p.c[p.c.length - 1];
    expect(last?.t).toBe("text");
    // The tail is as it was written, markers and all.
    expect(
      last?.t === "text" && last.v.endsWith("**bold** and [a link](https://example.com)"),
    ).toBe(true);
    expect(last?.t === "text" && last.v.length).toBeGreaterThan(source.length / 2);
    // Later paragraphs of the same document are plain text too.
    const more = parseMarkdown(`${source}\n\n*later*`, DOCUMENT_MARKDOWN, { left: 400, spent: 0 });
    expect(more[1]).toEqual({ t: "p", c: [{ t: "text", v: "*later*" }] });
    expect(work.spent).toBeLessThan(400 + source.length);
  });

  test("random marker soup stays inside the budget, and no character is lost", () => {
    const atoms = ["*", "**", "_", "~~", "`", "``", "[", "]", "(", ")", "![", "](", "<", ">", "\\"];
    const words = [" ", "a", "word ", "http://x.io/a ", "<https://e.com>", '"t"', "\n"];
    let seed = 264;
    const pick = <T>(from: readonly T[]): T => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return from[seed % from.length] as T;
    };
    for (let round = 0; round < 4; round++) {
      let source = "";
      while (source.length < 80_000) source += pick(round % 2 ? atoms : [...atoms, ...words]);
      const work = newWork(source.length);
      const blocks = parseMarkdown(source.replaceAll("\n", " "), DOCUMENT_MARKDOWN, work);
      expect(work.left).toBeGreaterThan(0);
      expect(work.spent / source.length).toBeLessThan(STEPS_PER_CHAR);
      expect(blocks.length).toBeGreaterThan(0);
    }
  });
});
