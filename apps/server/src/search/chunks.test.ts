import { describe, expect, test } from "bun:test";
import { chunkScrollback, fnv1a } from "./chunks.ts";

const lines = (from: number, to: number) =>
  Array.from(
    { length: to - from },
    (_, i) => `step ${from + i}: compiled module ${(from + i) * 7}`,
  );

describe("chunkScrollback", () => {
  test("covers every non-blank line, within the size bounds", () => {
    const text = lines(0, 500).join("\n");
    const chunks = chunkScrollback(text);
    expect(chunks.map((c) => c.body).join("\n")).toBe(text);
    for (const c of chunks) expect(c.body.split("\n").length).toBeLessThanOrEqual(48);
  });

  test("boundaries follow content, so shifted scrollback keeps most chunk hashes", () => {
    const a = new Set(chunkScrollback(lines(0, 600).join("\n")).map((c) => c.hash));
    const shifted = chunkScrollback(lines(100, 700).join("\n"));
    const kept = shifted.filter((c) => a.has(c.hash)).length;
    expect(kept / shifted.length).toBeGreaterThan(0.6);
  });

  test("blank lines at chunk edges and trailing spaces do not matter", () => {
    const one = chunkScrollback("\n\nhello   \nworld\n\n");
    expect(one).toEqual(chunkScrollback("hello\nworld"));
    expect(one[0]?.body).toBe("hello\nworld");
    expect(chunkScrollback("\n \n\n")).toEqual([]);
  });

  test("a huge single line is cut", () => {
    const chunks = chunkScrollback(`${"x".repeat(20_000)}\nend`, { maxChars: 6000 });
    for (const c of chunks) expect(c.body.length).toBeLessThanOrEqual(6000);
    expect(chunks.at(-1)?.body).toBe("end");
  });

  test("fnv1a is stable", () => {
    expect(fnv1a("")).toBe(0x811c9dc5);
    expect(fnv1a("a")).toBe(0xe40c292c);
  });
});
