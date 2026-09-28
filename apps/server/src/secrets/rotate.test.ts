import { describe, expect, test } from "bun:test";
import { parseEnvelope } from "./envelope.ts";
import { SecretsError } from "./errors.ts";
import { rotateEnvelope } from "./rotate.ts";
import { decryptSecret, encryptSecret } from "./secret.ts";
import {
  assertNoLeak,
  CONTEXT,
  forbiddenStrings,
  freshKey,
  keyringOf,
  PLAINTEXT,
} from "./test-helpers.ts";

const oldKey = freshKey();
const newKey = freshKey();
const both = keyringOf({ 1: oldKey, 2: newKey });

describe("rotateEnvelope", () => {
  const stored = encryptSecret(PLAINTEXT, CONTEXT, keyringOf({ 1: oldKey }), 1);
  const rotated = rotateEnvelope(stored, both, 2);

  test("keeps the data fields untouched and only re-wraps the DEK", () => {
    const before = parseEnvelope(stored);
    const after = parseEnvelope(rotated);
    expect(after.keyVersion).toBe(2);
    expect(after.nonce).toBe(before.nonce);
    expect(after.ciphertext).toBe(before.ciphertext);
    expect(after.tag).toBe(before.tag);
    expect(after.wrappedDek).not.toBe(before.wrappedDek);
    expect(after.wrapNonce).not.toBe(before.wrapNonce);
  });

  test("stays decryptable under the new key", () => {
    expect(decryptSecret(rotated, CONTEXT, keyringOf({ 2: newKey })).toString()).toBe(PLAINTEXT);
    expect(decryptSecret(rotated, CONTEXT, both).toString()).toBe(PLAINTEXT);
  });

  test("is not decryptable with only the old key", () => {
    let caught: unknown;
    try {
      decryptSecret(rotated, CONTEXT, keyringOf({ 1: oldKey }));
    } catch (error) {
      caught = error;
    }
    expect((caught as SecretsError).code).toBe("unknown_key_version");

    caught = undefined;
    try {
      decryptSecret(rotated, CONTEXT, keyringOf({ 2: oldKey }));
    } catch (error) {
      caught = error;
    }
    expect((caught as SecretsError).code).toBe("authentication_failed");
    assertNoLeak(caught, forbiddenStrings([oldKey, newKey]));
  });

  test("the original envelope still decrypts under the old key", () => {
    expect(decryptSecret(stored, CONTEXT, keyringOf({ 1: oldKey })).toString()).toBe(PLAINTEXT);
  });

  test("can rotate back and forth and to the same version", () => {
    const back = rotateEnvelope(rotated, both, 1);
    expect(decryptSecret(back, CONTEXT, keyringOf({ 1: oldKey })).toString()).toBe(PLAINTEXT);
    const same = rotateEnvelope(rotated, both, 2);
    expect(parseEnvelope(same).wrapNonce).not.toBe(parseEnvelope(rotated).wrapNonce);
    expect(decryptSecret(same, CONTEXT, both).toString()).toBe(PLAINTEXT);
  });

  test("fails when the source or target version is missing from the keyring", () => {
    expect(() => rotateEnvelope(stored, keyringOf({ 2: newKey }), 2)).toThrow(SecretsError);
    expect(() => rotateEnvelope(stored, keyringOf({ 1: oldKey }), 2)).toThrow(SecretsError);
  });

  test("fails with the wrong source key and never leaks material", () => {
    let caught: unknown;
    try {
      rotateEnvelope(stored, keyringOf({ 1: freshKey(), 2: newKey }), 2);
    } catch (error) {
      caught = error;
    }
    expect((caught as SecretsError).code).toBe("authentication_failed");
    assertNoLeak(caught, forbiddenStrings([oldKey, newKey]));
  });
});
