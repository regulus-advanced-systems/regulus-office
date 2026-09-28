import { describe, expect, test } from "bun:test";
import { REDACTED, Secret, SecretEnv } from "./secret.ts";

const KEY = "sk-test-DO-NOT-LEAK-1234";

function leaks(value: unknown): boolean {
  const renderings = [
    String(value),
    `${value}`,
    JSON.stringify(value),
    JSON.stringify({ nested: { value } }),
    Bun.inspect(value),
    Bun.inspect({ nested: { value } }),
  ];
  return renderings.some((text) => text.includes(KEY));
}

describe("Secret", () => {
  test("reveals only through reveal()", () => {
    const secret = Secret.of(KEY);
    expect(secret.reveal()).toBe(KEY);
    expect(leaks(secret)).toBe(false);
    expect(JSON.stringify(secret)).toBe(JSON.stringify(REDACTED));
  });

  test("rejects empty values", () => {
    expect(() => Secret.of("")).toThrow();
  });
});

describe("SecretEnv", () => {
  test("redacts values but keeps names visible", () => {
    const env = SecretEnv.of({ HOME: "/home/u", ANTHROPIC_API_KEY: Secret.of(KEY) });
    expect(leaks(env)).toBe(false);
    expect(env.names()).toEqual(["ANTHROPIC_API_KEY", "HOME"]);
    expect(JSON.parse(JSON.stringify(env))).toEqual({
      ANTHROPIC_API_KEY: REDACTED,
      HOME: REDACTED,
    });
    expect(String(env)).toContain("ANTHROPIC_API_KEY");
  });

  test("reveal() hands plaintext to the runner", () => {
    const env = SecretEnv.of({ A: "1" }).with("KEY", Secret.of(KEY));
    expect(env.reveal()).toEqual({ A: "1", KEY });
    expect(env.size).toBe(2);
  });

  test("is immutable and merges with later values winning", () => {
    const base = SecretEnv.of({ A: "1", B: "2" });
    const next = base.with("A", "3");
    expect(base.reveal()).toEqual({ A: "1", B: "2" });
    expect(base.merge(SecretEnv.of({ B: "9", C: "4" })).reveal()).toEqual({
      A: "1",
      B: "9",
      C: "4",
    });
    expect(next.has("A")).toBe(true);
  });

  test("rejects invalid variable names", () => {
    expect(() => SecretEnv.of({ "BAD NAME": "x" })).toThrow();
    expect(() => SecretEnv.empty().with("1X", "x")).toThrow();
  });
});
