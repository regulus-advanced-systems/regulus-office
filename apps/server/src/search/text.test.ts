import { describe, expect, test } from "bun:test";
import { indexableText, REDACTED, scrubSecrets, stripAnsi } from "./text.ts";

describe("stripAnsi", () => {
  test.each([
    ["SGR colours", "\x1b[1;31mred\x1b[0m text", "red text"],
    ["cursor moves and erase", "\x1b[2J\x1b[H\x1b[10;5Hhere\x1b[K", "here"],
    ["private modes", "\x1b[?1049h\x1b[?25lscreen\x1b[?25h", "screen"],
    ["OSC title with BEL", "\x1b]0;my title\x07prompt$", "prompt$"],
    ["OSC 8 hyperlink with ST", "\x1b]8;;https://x.test\x1b\\link\x1b]8;;\x1b\\", "link"],
    ["DCS string", "\x1bPq#0;2;0;0;0\x1b\\after", "after"],
    ["charset selection", "\x1b(Bplain\x1b=", "plain"],
    ["8-bit CSI", "\x9b31mred", "red"],
    ["bell and other controls", "a\x07b\x00c\x7fd", "abcd"],
    ["backspace", "helx\blo", "hello"],
    ["carriage return overwrite", "50%\r100%", "100%"],
    ["shorter overwrite keeps the tail", "abcdef\rXY", "XYcdef"],
    ["CRLF endings", "one\r\ntwo\r\n", "one\ntwo\n"],
    ["tabs and newlines kept", "a\tb\nc", "a\tb\nc"],
    ["snippet markers cannot be smuggled in", "x\u0002y\u0003z", "xyz"],
    ["unterminated OSC eats the rest", "ok\x1b]0;never ends", "ok"],
  ])("%s", (_name, input, want) => {
    expect(stripAnsi(input)).toBe(want);
  });

  test("keeps unicode text", () => {
    expect(stripAnsi("\x1b[32m✓ Tests passed — žluťoučký\x1b[0m")).toBe(
      "✓ Tests passed — žluťoučký",
    );
  });
});

describe("scrubSecrets", () => {
  test.each([
    ["Anthropic key", "key sk-ant-api03-AbCdEfGhIjKlMnOpQrStUv done"],
    ["OpenAI key", "export X=1 sk-proj-AbCdEfGhIjKlMnOpQrStUvWx"],
    ["GitHub token", "token ghp_abcdefghijklmnopqrstuvwxyz0123456789"],
    ["GitHub PAT", "github_pat_11ABCDEFG0123456789_abcdefghijklmnop"],
    ["AWS key id", "AKIAIOSFODNN7EXAMPLE"],
    ["Slack token", "xoxb-1234567890-abcdefghij"],
    ["Google key", "AIzaSyA-1234567890abcdefghijklmnopqrstu"],
    [
      "JWT",
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
    ],
    ["bearer header", "Authorization: Bearer abc.def-ghi_jkl~mno"],
  ])("%s", (_name, input) => {
    const out = scrubSecrets(input);
    expect(out).toContain(REDACTED);
    expect(out).not.toMatch(
      /sk-ant-api03|sk-proj-Ab|ghp_abc|github_pat_11|AKIAIOSF|xoxb-12|AIzaSy|eyJhbGci|abc\.def/,
    );
  });

  test("secret-looking assignments keep their name, lose their value", () => {
    expect(scrubSecrets("DEEPSEEK_API_KEY=abcd1234efgh")).toBe(`DEEPSEEK_API_KEY=${REDACTED}`);
    expect(scrubSecrets('password: "hunter2hunter2"')).toBe(`password: "${REDACTED}`.concat('"'));
    expect(scrubSecrets("client_secret = s3cr3tvalue,")).toBe(`client_secret = ${REDACTED},`);
  });

  test("plain numbers under token-ish names are left alone", () => {
    expect(scrubSecrets("input_tokens: 123456")).toBe("input_tokens: 123456");
    expect(scrubSecrets("max_tokens=4096")).toBe("max_tokens=4096");
  });

  test("URL credentials and private keys", () => {
    expect(scrubSecrets("git clone https://bob:pa55word@github.com/x/y")).toBe(
      `git clone https://${REDACTED}@github.com/x/y`,
    );
    const pem = "-----BEGIN RSA PRIVATE KEY-----\nMIIEow\nIBAAK\n-----END RSA PRIVATE KEY-----";
    expect(scrubSecrets(`before\n${pem}\nafter`)).toBe(`before\n${REDACTED}\nafter`);
  });

  test("ordinary output is untouched", () => {
    const text = "✓ 42 tests passed\nauthor: Ada\nsee https://github.com/o/r/pull/7";
    expect(scrubSecrets(text)).toBe(text);
  });
});

test("indexableText strips escapes before scrubbing (colour codes cannot split a key)", () => {
  const out = indexableText(
    "\x1b[33mOPENAI_API_KEY\x1b[0m=\x1b[1msk-abcdefghijklmnopqrstuvwx\x1b[0m",
  );
  expect(out).not.toContain("abcdefghij");
});
