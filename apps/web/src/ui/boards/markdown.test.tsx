import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Markdown } from "./Markdown.tsx";
import { parseInline, parseMarkdown, safeUrl } from "./markdown.ts";

const html = (source: string) => renderToStaticMarkup(<Markdown source={source} />);

describe("safeUrl", () => {
  test("keeps absolute http(s) and mailto links", () => {
    expect(safeUrl("https://github.com/octo/hello/issues/1")).toBe(
      "https://github.com/octo/hello/issues/1",
    );
    expect(safeUrl("http://example.com")).toBe("http://example.com/");
    expect(safeUrl("mailto:ada@example.com")).toBe("mailto:ada@example.com");
    expect(safeUrl("<https://example.com/a>")).toBe("https://example.com/a");
  });

  test("drops script, data, file, relative and obfuscated targets", () => {
    for (const bad of [
      "javascript:alert(1)",
      "JaVaScRiPt:alert(1)",
      "java\tscript:alert(1)",
      " javascript:alert(1)",
      "data:text/html;base64,PHNjcmlwdD4=",
      "vbscript:msgbox(1)",
      "file:///etc/passwd",
      "/relative/path",
      "../up",
      "#anchor",
      "//evil.example/x",
      "",
    ]) {
      expect(safeUrl(bad)).toBeNull();
    }
  });
});

describe("markdown rendering is sanitised", () => {
  test("raw HTML is shown as text, never as elements", () => {
    const out = html(
      '<script>alert(1)</script>\n\n<img src=x onerror="alert(1)">\n\n<a href="javascript:x">hi</a>',
    );
    expect(out).not.toContain("<script");
    expect(out).not.toContain("<img");
    expect(out).not.toContain('<a href="javascript');
    expect(out).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(out).toContain("&lt;img");
  });

  test("unsafe link targets become plain text; safe ones open safely", () => {
    const out = html("[click](javascript:alert(1)) and [docs](https://example.com/docs)");
    expect(out).not.toContain("javascript:");
    expect(out).toContain("click");
    expect(out).toContain(
      '<a href="https://example.com/docs" target="_blank" rel="noopener noreferrer nofollow ugc" referrerPolicy="no-referrer">docs</a>',
    );
  });

  test("images are never loaded, only linked", () => {
    const out = html("![diagram](https://evil.example/track.png) ![x](javascript:1)");
    expect(out).not.toContain("<img");
    expect(out).toContain('href="https://evil.example/track.png"');
    expect(out).toContain("Image: diagram");
    expect(out).toContain("Image: x");
    expect(out).not.toContain("javascript:");
  });

  test("HTML comments (PR templates) are dropped", () => {
    expect(html("<!-- describe your change -->\nFixes the thing")).toBe(
      '<div class="rg-md"><p>Fixes the thing</p></div>',
    );
  });

  test("task list items render inline with a disabled checkbox", () => {
    const out = html("- [x] oil them\n- plain");
    expect(out).toContain('<li class="rg-md__task"><input type="checkbox" disabled=""');
    expect(out).toContain("/>oil them</li>");
    expect(out).toContain("<li>plain</li>");
  });

  test("an empty body says so", () => {
    expect(html("   \n<!-- only a template -->")).toContain("No description.");
  });
});

describe("markdown structure", () => {
  test("headings, lists, task lists, code, quotes and rules", () => {
    const blocks = parseMarkdown(
      [
        "## Steps",
        "- one",
        "- [x] done",
        "- [ ] todo",
        "",
        "1. first",
        "2. second",
        "",
        "```ts",
        "const a = '<b>';",
        "```",
        "> quoted **bold**",
        "",
        "---",
        "line one",
        "line two",
      ].join("\n"),
    );
    expect(blocks.map((b) => b.t)).toEqual(["h", "list", "list", "code", "quote", "hr", "p"]);
    const tasks = blocks[1];
    expect(tasks?.t === "list" && tasks.items.map((i) => i.checked)).toEqual([null, true, false]);
    const ordered = blocks[2];
    expect(ordered?.t === "list" && ordered.ordered).toBe(true);
    expect(blocks[3]).toEqual({ t: "code", lang: "ts", v: "const a = '<b>';" });
    const para = blocks[6];
    expect(para?.t === "p" && para.c.map((n) => n.t)).toEqual(["text", "br", "text"]);
  });

  test("inline code, emphasis, strikethrough, autolinks and escapes", () => {
    expect(parseInline("`a*b*` **bold** *em* _em_ ~~gone~~ \\*lit\\*")).toEqual([
      { t: "code", v: "a*b*" },
      { t: "text", v: " " },
      { t: "strong", c: [{ t: "text", v: "bold" }] },
      { t: "text", v: " " },
      { t: "em", c: [{ t: "text", v: "em" }] },
      { t: "text", v: " " },
      { t: "em", c: [{ t: "text", v: "em" }] },
      { t: "text", v: " " },
      { t: "del", c: [{ t: "text", v: "gone" }] },
      { t: "text", v: " *lit*" },
    ]);
    expect(parseInline("see https://example.com/a.")).toEqual([
      { t: "text", v: "see " },
      { t: "link", href: "https://example.com/a", c: [{ t: "text", v: "https://example.com/a" }] },
      { t: "text", v: "." },
    ]);
    expect(parseInline("snake_case_name")).toEqual([{ t: "text", v: "snake_case_name" }]);
  });

  test("very long input is capped", () => {
    const blocks = parseMarkdown("a".repeat(200_000));
    const p = blocks[0];
    expect(p?.t === "p" && p.c[0]?.t === "text" && p.c[0].v.length).toBe(65_536);
  });
});
