import { describe, expect, test } from "bun:test";
import { SecretsError } from "./errors.ts";
import { REDACTED, redact, redactText } from "./redact.ts";

describe("redact", () => {
  test("replaces strings and byte buffers entirely", () => {
    expect(redact("sk-FAKE-1234")).toBe(REDACTED);
    expect(redact("")).toBe(REDACTED);
    expect(redact(Buffer.from("x"))).toBe(REDACTED);
    expect(redact(new Uint8Array(3))).toBe(REDACTED);
    expect(redact(new ArrayBuffer(3))).toBe(REDACTED);
  });

  test("passes primitives through", () => {
    expect(redact(42)).toBe(42);
    expect(redact(true)).toBe(true);
    expect(redact(null)).toBeNull();
    expect(redact(undefined)).toBeUndefined();
  });

  test("redacts sensitive keys and recurses into the rest", () => {
    const input = {
      userId: "u1",
      provider: "deepseek",
      keyVersion: 2,
      apiKey: "sk-FAKE",
      raw: Buffer.from("sk-FAKE"),
      nested: { token: 123, count: 2, list: ["a", 1, { password: "p" }] },
      encryptedSecret: { v: 1 },
      when: new Date(0),
    };
    expect(redact(input)).toEqual({
      userId: "u1",
      provider: "deepseek",
      keyVersion: 2,
      apiKey: REDACTED,
      raw: REDACTED,
      nested: { token: REDACTED, count: 2, list: ["a", 1, { password: REDACTED }] },
      encryptedSecret: REDACTED,
      when: "1970-01-01T00:00:00.000Z",
    });
    expect(JSON.stringify(redact(input))).not.toContain("sk-FAKE");
  });

  test("does not mutate the input", () => {
    const input = { apiKey: "sk-FAKE" };
    redact(input);
    expect(input.apiKey).toBe("sk-FAKE");
  });

  test("cuts cycles and depth", () => {
    const loop: Record<string, unknown> = { n: 1 };
    loop.self = loop;
    expect(redact(loop)).toEqual({ n: 1, self: "[circular]" });

    let deep: unknown = { n: 1 };
    for (let i = 0; i < 12; i += 1) deep = { child: deep };
    expect(JSON.stringify(redact(deep))).toContain("[depth]");
  });

  test("keeps SecretsError details but hides other error messages", () => {
    const ours = redact(new SecretsError("unknown_key_version", 4));
    expect(ours).toEqual({
      name: "SecretsError",
      message: expect.stringContaining("key version 4"),
      code: "unknown_key_version",
      keyVersion: 4,
    });
    expect(redact(new Error("contains sk-FAKE"))).toEqual({ name: "Error", message: REDACTED });
  });
});

describe("redactText", () => {
  test("keeps the sentence and replaces keys, env values, paths and token-like runs", () => {
    expect(redactText("reading auth.ts")).toBe("reading auth.ts");
    expect(redactText("used sk-ant-api03-abcdefgh12345678 today")).toBe("used [redacted] today");
    expect(redactText("OPENAI_API_KEY=abc123 ran")).toBe("OPENAI_API_KEY=[redacted] ran");
    expect(redactText("open /home/ada/.ssh/id_rsa now")).toBe("open <path> now");
    expect(redactText(`id ${"a".repeat(40)}`)).toBe("id [redacted]");
    const once = redactText("TOKEN=x /etc/passwd ghp_abcdefgh12345678");
    expect(redactText(once)).toBe(once);
  });
});
