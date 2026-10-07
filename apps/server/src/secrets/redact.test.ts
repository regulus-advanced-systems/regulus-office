import { describe, expect, test } from "bun:test";
import { SecretsError } from "./errors.ts";
import { findSecretLike, REDACTED, redact, redactText } from "./redact.ts";

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

describe("findSecretLike (#136): text that must not be stored", () => {
  test("keys, tokens, private keys and secret settings are found, with their line", () => {
    expect(findSecretLike("ok\nkey sk-ant-api03-FAKEFAKE")).toEqual({
      kind: "provider_key",
      line: 2,
    });
    expect(findSecretLike("ghp_FAKE12345678")?.kind).toBe("provider_key");
    expect(findSecretLike("github_pat_FAKE12345678")?.kind).toBe("provider_key");
    expect(findSecretLike("a\nb\nroa_FAKEFAKEFAKE")).toEqual({ kind: "office_token", line: 3 });
    expect(findSecretLike("-----BEGIN RSA PRIVATE KEY-----")?.kind).toBe("private_key");
    expect(findSecretLike("ANTHROPIC_API_KEY=abc")?.kind).toBe("env_secret");
    expect(findSecretLike('DB_PASSWORD="hunter2"')?.kind).toBe("env_secret");
    expect(findSecretLike("0123456789abcdef0123456789abcdef01234567")?.kind).toBe("token");
    expect(findSecretLike("QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo/MTIzNA==")?.kind).toBe("token");
  });

  test("ordinary text is not: ids, links, paths, plain settings, rules, an empty secret setting", () => {
    for (const text of [
      "operation 3f2b8c1e-9a4d-4e6f-8b7a-0c1d2e3f4a5b",
      "https://github.com/regulus-advanced-systems/regulus-office/pull/284",
      "docs/screenshots/136/agent-card-with-memories-and-notes.png",
      "PORT=3000 NODE_ENV=production",
      "API_KEY= is set in the vault, not here",
      "--------------------------------------------",
      "a perfectly ordinary sentence about nothing in particular at all",
    ]) {
      expect([text, findSecretLike(text)]).toEqual([text, null]);
    }
  });
});
