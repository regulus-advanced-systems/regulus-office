import { describe, expect, test } from "bun:test";
import { parseEnvelope } from "./envelope.ts";
import { SecretsError } from "./errors.ts";
import { decryptSecret, decryptSecretToString, encryptSecret } from "./secret.ts";
import {
  assertNoLeak,
  CONTEXT,
  flipFirstChar,
  forbiddenStrings,
  freshKey,
  keyringOf,
  PLAINTEXT,
  withField,
} from "./test-helpers.ts";

const masterKey = freshKey();
const keyring = keyringOf({ 1: masterKey });

function failsAuth(fn: () => unknown): void {
  let caught: unknown;
  try {
    fn();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(SecretsError);
  expect((caught as SecretsError).code).toBe("authentication_failed");
  assertNoLeak(caught, forbiddenStrings([masterKey]));
}

describe("encryptSecret / decryptSecret", () => {
  test("round-trips a string and a Buffer", () => {
    const stored = encryptSecret(PLAINTEXT, CONTEXT, keyring, 1);
    expect(decryptSecret(stored, CONTEXT, keyring).toString("utf8")).toBe(PLAINTEXT);
    expect(decryptSecretToString(stored, CONTEXT, keyring)).toBe(PLAINTEXT);

    const bytes = Buffer.from([0, 255, 1, 254, 7]);
    const storedBytes = encryptSecret(bytes, CONTEXT, keyring, 1);
    expect(decryptSecret(storedBytes, CONTEXT, keyring)).toEqual(bytes);
    expect(bytes).toEqual(Buffer.from([0, 255, 1, 254, 7]));
  });

  test("accepts a parsed envelope object as well as the stored string", () => {
    const stored = encryptSecret(PLAINTEXT, CONTEXT, keyring, 1);
    expect(decryptSecret(parseEnvelope(stored), CONTEXT, keyring).toString()).toBe(PLAINTEXT);
  });

  test("produces the documented envelope shape and a text-column-sized string", () => {
    const stored = encryptSecret(PLAINTEXT, CONTEXT, keyring, 1);
    expect(stored).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(stored.length).toBeLessThan(600);
    const envelope = parseEnvelope(stored);
    expect(envelope.v).toBe(1);
    expect(envelope.keyVersion).toBe(1);
    expect(Buffer.from(envelope.nonce, "base64url").length).toBe(12);
    expect(Buffer.from(envelope.tag, "base64url").length).toBe(16);
    expect(Buffer.from(envelope.wrappedDek, "base64url").length).toBe(48);
    expect(Buffer.from(envelope.wrapNonce, "base64url").length).toBe(12);
    expect(Buffer.from(envelope.ciphertext, "base64url").length).toBe(Buffer.byteLength(PLAINTEXT));
  });

  test("stored form never contains the plaintext or the master key", () => {
    const stored = encryptSecret(PLAINTEXT, CONTEXT, keyring, 1);
    const decoded = Buffer.from(stored, "base64url").toString("utf8");
    for (const needle of forbiddenStrings([masterKey])) {
      expect(stored).not.toContain(needle);
      expect(decoded).not.toContain(needle);
    }
  });

  test("uses a fresh DEK and nonces every time", () => {
    const a = parseEnvelope(encryptSecret(PLAINTEXT, CONTEXT, keyring, 1));
    const b = parseEnvelope(encryptSecret(PLAINTEXT, CONTEXT, keyring, 1));
    expect(a.nonce).not.toBe(b.nonce);
    expect(a.wrapNonce).not.toBe(b.wrapNonce);
    expect(a.wrappedDek).not.toBe(b.wrappedDek);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  test("rejects empty plaintext, unknown key version and bad context", () => {
    expect(() => encryptSecret("", CONTEXT, keyring, 1)).toThrow(SecretsError);
    expect(() => encryptSecret(Buffer.alloc(0), CONTEXT, keyring, 1)).toThrow(SecretsError);
    expect(() => encryptSecret(PLAINTEXT, CONTEXT, keyring, 2)).toThrow(SecretsError);
    for (const context of [
      { userId: "", secretName: "x" },
      { userId: "u", secretName: "" },
      { userId: "a|b", secretName: "x" },
      { userId: "u", secretName: "a|b" },
    ]) {
      expect(() => encryptSecret(PLAINTEXT, context, keyring, 1)).toThrow(SecretsError);
    }
  });
});

describe("decryptSecret fails when", () => {
  const stored = encryptSecret(PLAINTEXT, CONTEXT, keyring, 1);

  test("the userId differs", () => {
    failsAuth(() => decryptSecret(stored, { ...CONTEXT, userId: "user_OTHER" }, keyring));
  });

  test("the secretName differs", () => {
    failsAuth(() => decryptSecret(stored, { ...CONTEXT, secretName: "kimi:api_key" }, keyring));
  });

  test("userId and secretName are swapped", () => {
    failsAuth(() =>
      decryptSecret(stored, { userId: CONTEXT.secretName, secretName: CONTEXT.userId }, keyring),
    );
  });

  test("the ciphertext is tampered", () => {
    failsAuth(() =>
      decryptSecret(withField(stored, "ciphertext", flipFirstChar), CONTEXT, keyring),
    );
  });

  test("the tag is tampered", () => {
    failsAuth(() => decryptSecret(withField(stored, "tag", flipFirstChar), CONTEXT, keyring));
  });

  test("the nonce is tampered", () => {
    failsAuth(() => decryptSecret(withField(stored, "nonce", flipFirstChar), CONTEXT, keyring));
  });

  test("the wrapped DEK is tampered", () => {
    failsAuth(() =>
      decryptSecret(withField(stored, "wrappedDek", flipFirstChar), CONTEXT, keyring),
    );
  });

  test("the wrap nonce is tampered", () => {
    failsAuth(() => decryptSecret(withField(stored, "wrapNonce", flipFirstChar), CONTEXT, keyring));
  });

  test("the wrapped DEK is swapped in from another secret", () => {
    const other = parseEnvelope(encryptSecret("other-FAKE-secret", CONTEXT, keyring, 1));
    const swapped = withField(
      withField(stored, "wrappedDek", () => other.wrappedDek),
      "wrapNonce",
      () => other.wrapNonce,
    );
    failsAuth(() => decryptSecret(swapped, CONTEXT, keyring));
  });

  test("the master key is wrong", () => {
    failsAuth(() => decryptSecret(stored, CONTEXT, keyringOf({ 1: freshKey() })));
  });

  test("the key version is unknown", () => {
    const relabelled = withField(stored, "keyVersion", () => 9);
    let caught: unknown;
    try {
      decryptSecret(relabelled, CONTEXT, keyring);
    } catch (error) {
      caught = error;
    }
    expect((caught as SecretsError).code).toBe("unknown_key_version");
    assertNoLeak(caught, forbiddenStrings([masterKey]));
  });

  test("the key version label is changed while the key is the same", () => {
    const relabelled = withField(stored, "keyVersion", () => 2);
    failsAuth(() => decryptSecret(relabelled, CONTEXT, keyringOf({ 1: masterKey, 2: masterKey })));
  });
});
