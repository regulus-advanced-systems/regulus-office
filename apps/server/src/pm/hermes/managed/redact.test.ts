/** What a managed Hermes printed, made safe to show (#57). */
import { describe, expect, test } from "bun:test";
import { describeExit, redact } from "./redact.ts";

describe("redacting what a gateway printed", () => {
  test("every secret it was handed is cut out by value, the longest first", () => {
    const text = "key=abcdef-123456 and abcdef-123456-more and short=abc";
    expect(redact(text, ["abcdef-123456", "abcdef-123456-more", "abc"])).toBe(
      "key=[hidden] and [hidden] and short=abc",
    );
  });

  test("what looks like a key or a token is cut out by shape, known or not", () => {
    const out = redact(
      "Authorization: Bearer whatever.it.is sk-ant-api03-zzzzzzzzzz roa_abcdefghijkl 0123456789abcdef0123456789abcdef0123",
      [],
    );
    expect(out).toBe("Authorization: [hidden] [hidden] [hidden] [hidden]");
  });

  test("an exit is described by its code and its last line; a killed one by that alone", () => {
    const tail = "INFO starting\n\u001b[31mERROR\u001b[0m bad provider in config.yaml\n\n";
    expect(describeExit({ code: 1, tail }, [])).toBe(
      "exit code 1: ERROR bad provider in config.yaml",
    );
    expect(describeExit({ code: 2, tail: "" }, [])).toBe("exit code 2");
    expect(describeExit({ code: null, tail }, [])).toBe("it was killed");
    expect(describeExit({ code: 137, tail }, [])).toBe("it was killed");
    expect(describeExit({ code: 1, tail: `x${"y".repeat(400)}` }, []).length).toBeLessThan(220);
  });
});
