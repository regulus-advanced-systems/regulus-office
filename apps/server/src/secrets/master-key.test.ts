import { describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { SecretsError } from "./errors.ts";
import { loadMasterKeyring, lookupKey, parseKeyVersion, parseMasterKey } from "./master-key.ts";
import { assertNoLeak } from "./test-helpers.ts";

function expectRejected(raw: unknown, code: SecretsError["code"] = "invalid_master_key"): void {
  let caught: unknown;
  try {
    parseMasterKey(raw);
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(SecretsError);
  expect((caught as SecretsError).code).toBe(code);
  if (typeof raw === "string" && raw.length > 0) assertNoLeak(caught, [raw]);
}

describe("parseMasterKey", () => {
  const key = randomBytes(32);

  test("accepts 64 hex chars in either case", () => {
    expect(parseMasterKey(key.toString("hex"))).toEqual(key);
    expect(parseMasterKey(key.toString("hex").toUpperCase())).toEqual(key);
  });

  test("accepts standard base64 with or without padding, and base64url", () => {
    expect(parseMasterKey(key.toString("base64"))).toEqual(key);
    expect(parseMasterKey(key.toString("base64").replace(/=+$/, ""))).toEqual(key);
    expect(parseMasterKey(key.toString("base64url"))).toEqual(key);
  });

  test("trims surrounding whitespace", () => {
    expect(parseMasterKey(`  ${key.toString("hex")}\n`)).toEqual(key);
  });

  test("rejects malformed values with a fixed message that does not echo the value", () => {
    expectRejected(undefined);
    expectRejected(null);
    expectRejected(42);
    expectRejected("");
    expectRejected("hunter2");
    expectRejected(randomBytes(16).toString("hex"));
    expectRejected(randomBytes(31).toString("base64"));
    expectRejected(randomBytes(33).toString("base64"));
    expectRejected(randomBytes(48).toString("base64"));
    expectRejected(`${key.toString("hex").slice(0, 63)}g`);
    expectRejected(`${key.toString("base64")}==`);
    expectRejected(key.toString("base64").replace("=", "!"));
  });
});

describe("parseKeyVersion", () => {
  test("accepts positive integers as numbers or decimal strings", () => {
    expect(parseKeyVersion(1)).toBe(1);
    expect(parseKeyVersion("7")).toBe(7);
    expect(parseKeyVersion(" 12 ")).toBe(12);
  });

  test("rejects everything else", () => {
    for (const bad of [0, -1, 1.5, "0", "01", "x", "", undefined, null, "99999999999"]) {
      expect(() => parseKeyVersion(bad)).toThrow(SecretsError);
    }
  });
});

describe("lookupKey", () => {
  const k1 = randomBytes(32);

  test("returns the key for a known version", () => {
    expect(lookupKey({ 1: k1 }, 1)).toBe(k1);
  });

  test("reports unknown versions without leaking key material", () => {
    let caught: unknown;
    try {
      lookupKey({ 1: k1 }, 2);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(SecretsError);
    expect((caught as SecretsError).code).toBe("unknown_key_version");
    expect((caught as SecretsError).keyVersion).toBe(2);
    expect((caught as SecretsError).message).toContain("key version 2");
    assertNoLeak(caught, [k1.toString("hex"), k1.toString("base64")]);
  });

  test("does not resolve prototype properties or short keys", () => {
    expect(() => lookupKey({}, "constructor" as unknown as number)).toThrow(SecretsError);
    expect(() => lookupKey({ 1: Buffer.alloc(16) }, 1)).toThrow(SecretsError);
  });
});

describe("loadMasterKeyring", () => {
  const current = randomBytes(32);
  const previous = randomBytes(32);

  test("defaults to version 1 with only OFFICE_MASTER_KEY set", () => {
    const ring = loadMasterKeyring({ OFFICE_MASTER_KEY: current.toString("base64") });
    expect(ring.current).toBe(1);
    expect(ring.keys[1]).toEqual(current);
    expect(Object.keys(ring.keys)).toEqual(["1"]);
  });

  test("loads previous versions for rotation", () => {
    const ring = loadMasterKeyring({
      OFFICE_MASTER_KEY: current.toString("hex"),
      OFFICE_MASTER_KEY_VERSION: "3",
      OFFICE_MASTER_KEY_PREVIOUS: `2:${previous.toString("base64")}`,
    });
    expect(ring.current).toBe(3);
    expect(ring.keys[3]).toEqual(current);
    expect(ring.keys[2]).toEqual(previous);
  });

  test("rejects a missing key, bad version, malformed previous list and duplicate versions", () => {
    expect(() => loadMasterKeyring({})).toThrow(SecretsError);
    expect(() =>
      loadMasterKeyring({
        OFFICE_MASTER_KEY: current.toString("hex"),
        OFFICE_MASTER_KEY_VERSION: "0",
      }),
    ).toThrow(SecretsError);
    expect(() =>
      loadMasterKeyring({
        OFFICE_MASTER_KEY: current.toString("hex"),
        OFFICE_MASTER_KEY_PREVIOUS: previous.toString("hex"),
      }),
    ).toThrow(SecretsError);
    expect(() =>
      loadMasterKeyring({
        OFFICE_MASTER_KEY: current.toString("hex"),
        OFFICE_MASTER_KEY_PREVIOUS: `1:${previous.toString("hex")}`,
      }),
    ).toThrow(SecretsError);
  });
});
