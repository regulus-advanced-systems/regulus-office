import { describe, expect, test } from "bun:test";
import { openExternalLink, safeHttpUrl } from "./links.ts";

describe("terminal links", () => {
  test("only absolute http(s) links without credentials", () => {
    expect(safeHttpUrl("https://example.com/a?b=1")).toBe("https://example.com/a?b=1");
    expect(safeHttpUrl("http://localhost:3000/")).toBe("http://localhost:3000/");
    expect(safeHttpUrl("javascript:alert(1)")).toBeNull();
    expect(safeHttpUrl("file:///etc/passwd")).toBeNull();
    expect(safeHttpUrl("data:text/html,hi")).toBeNull();
    expect(safeHttpUrl("https://user:pw@example.com/")).toBeNull();
    expect(safeHttpUrl("/relative")).toBeNull();
  });

  test("open in a new tab with noopener and noreferrer", () => {
    const opened: string[][] = [];
    const open = (url: string, target: string, features: string) =>
      opened.push([url, target, features]);
    expect(openExternalLink("https://claude.ai/x", open)).toBe(true);
    expect(openExternalLink("javascript:alert(1)", open)).toBe(false);
    expect(opened).toEqual([["https://claude.ai/x", "_blank", "noopener,noreferrer"]]);
  });
});
