import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { SEARCH_QUERY_MAX, SEARCH_TERMS_MAX } from "@regulus/protocol";
import { ftsString, parseSearchQuery, TERM_MAX } from "./query.ts";
import { bestLine } from "./searcher.ts";

describe("parseSearchQuery", () => {
  test("words are quoted and ANDed; the last one is a prefix", () => {
    expect(parseSearchQuery("build failed")).toEqual({
      match: '"build" AND "failed"*',
      terms: ["build", "failed"],
    });
  });

  test("balanced quotes make a phrase, which is never a prefix", () => {
    expect(parseSearchQuery('npm "exit code" 1')?.match).toBe('"npm" AND "exit code" AND "1"');
    expect(parseSearchQuery('"exit code"')?.match).toBe('"exit code"');
  });

  test("a one-letter last word is not a prefix query", () => {
    expect(parseSearchQuery("x")?.match).toBe('"x"');
  });

  test.each([
    ["boolean operators", "foo OR bar NOT baz", '"foo" AND "OR" AND "bar" AND "NOT" AND "baz"*'],
    ["NEAR group", "NEAR(a b, 2)", '"NEAR" AND "a" AND "b" AND "2"'],
    ["column filter", "body:secret", '"body" AND "secret"*'],
    ["initial token and star", "^start* +more", '"start" AND "more"*'],
    ["parentheses", "(a) AND (b)", '"a" AND "AND" AND "b"'],
    ["unbalanced quote", 'say "hello', '"say" AND "hello"*'],
    ["embedded quotes", 'a""b', '"a" AND "b"'],
    ["curly braces and minus", "{body} -x", '"body" AND "x"'],
  ])("%s is plain text", (_name, input, match) => {
    expect(parseSearchQuery(input)?.match).toBe(match);
  });

  test("nothing searchable → null", () => {
    for (const q of ["", "   ", '""', "*", "()", "^-+:", "\u0000\u0002"]) {
      expect(parseSearchQuery(q)).toBeNull();
    }
  });

  test("unicode words survive, terms are lower-cased and unique", () => {
    expect(parseSearchQuery("Žluťoučký kůň KŮŇ")).toEqual({
      match: '"Žluťoučký" AND "kůň" AND "KŮŇ"*',
      terms: ["žluťoučký", "kůň"],
    });
  });

  test("length, term count and term size are capped", () => {
    const many = Array.from({ length: 20 }, (_, i) => `w${i}`).join(" ");
    expect(parseSearchQuery(many)?.terms).toHaveLength(SEARCH_TERMS_MAX);
    const long = "a".repeat(SEARCH_QUERY_MAX * 2);
    expect(parseSearchQuery(long)?.terms[0]?.length).toBe(TERM_MAX);
  });

  test("ftsString doubles quotes", () => {
    expect(ftsString('a"b')).toBe('"a""b"');
  });
});

describe("every parsed query is valid FTS5", () => {
  const db = new Database(":memory:");
  db.run("CREATE VIRTUAL TABLE t USING fts5(body)");
  db.run("INSERT INTO t (body) VALUES ('the build failed with exit code 1'), ('NEAR OR NOT body')");
  const inputs = [
    'foo" OR body:*',
    "NEAR(",
    ")",
    '"',
    "a AND",
    "OR OR OR",
    "body:build",
    "* failed",
    "exit code 1",
    '"exit code" failed',
    "fail",
    "\\x1b[31m",
    "'; DROP TABLE t; --",
    "😀 build",
  ];
  test.each(inputs)("%p", (input) => {
    const parsed = parseSearchQuery(input);
    if (!parsed) return;
    expect(() => db.query("SELECT rowid FROM t WHERE t MATCH ?").all(parsed.match)).not.toThrow();
  });

  test("the operators in the text are matched as words", () => {
    const parsed = parseSearchQuery("NEAR OR NOT");
    expect(db.query("SELECT rowid FROM t WHERE t MATCH ?").all(parsed?.match ?? "")).toHaveLength(
      1,
    );
  });

  test("prefix matching finds the word being typed", () => {
    const parsed = parseSearchQuery("fail");
    expect(db.query("SELECT rowid FROM t WHERE t MATCH ?").all(parsed?.match ?? "")).toHaveLength(
      1,
    );
  });
});

describe("bestLine", () => {
  test("prefers the line with the phrase, then the most terms, then the first", () => {
    const lines = ["FAKE CLAUDE session 1", "noise", "FAKE CLAUDE DONE"];
    expect(bestLine(lines, ["fake", "claude", "done"])).toBe(2);
    expect(bestLine(lines, ["claude"])).toBe(0);
    expect(bestLine(["a", "b"], ["zzz"])).toBe(0);
    expect(bestLine(["done fake claude", "fake claude done"], ["fake", "claude", "done"])).toBe(1);
  });
});
