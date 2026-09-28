import { describe, expect, test } from "bun:test";
import {
  ENVELOPE_VERSION,
  envelopeFrom,
  fromBase64Url,
  isKeyVersion,
  parseEnvelope,
  type SecretEnvelope,
  serializeEnvelope,
  toBase64Url,
} from "./envelope.ts";
import { SecretsError } from "./errors.ts";

/** Fixed, obviously fake bytes: nonce = 0x01.., tag = 0x02.., etc. Not derived from any real key. */
const FIXTURE: SecretEnvelope = {
  v: ENVELOPE_VERSION,
  keyVersion: 3,
  nonce: toBase64Url(Buffer.alloc(12, 0x01)),
  ciphertext: toBase64Url(Buffer.from("fake-ciphertext-bytes")),
  tag: toBase64Url(Buffer.alloc(16, 0x02)),
  wrappedDek: toBase64Url(Buffer.alloc(48, 0x03)),
  wrapNonce: toBase64Url(Buffer.alloc(12, 0x04)),
};

/** Golden serialisation of FIXTURE. Changing the key order or encoding must fail this test. */
const GOLDEN =
  "eyJ2IjoxLCJrZXlWZXJzaW9uIjozLCJub25jZSI6IkFRRUJBUUVCQVFFQkFRRUIiLCJjaXBoZXJ0ZXh0IjoiWm1GclpTMWphWEJvWlhKMFpYaDBMV0o1ZEdWeiIsInRhZyI6IkFnSUNBZ0lDQWdJQ0FnSUNBZ0lDQWciLCJ3cmFwcGVkRGVrIjoiQXdNREF3TURBd01EQXdNREF3TURBd01EQXdNREF3TURBd01EQXdNREF3TURBd01EQXdNREF3TURBd01EQXdNRCIsIndyYXBOb25jZSI6IkJBUUVCQVFFQkFRRUJBUUUifQ";

function expectCode(fn: () => unknown, code: SecretsError["code"]): void {
  let caught: unknown;
  try {
    fn();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(SecretsError);
  expect((caught as SecretsError).code).toBe(code);
}

describe("envelope serialisation", () => {
  test("is stable: matches the golden string and round-trips byte for byte", () => {
    const stored = serializeEnvelope(FIXTURE);
    expect(stored).toBe(GOLDEN);
    expect(parseEnvelope(stored)).toEqual(FIXTURE);
    expect(serializeEnvelope(parseEnvelope(stored))).toBe(stored);
  });

  test("ignores input key order and drops unknown keys", () => {
    const reversed = [...Object.entries(FIXTURE)].reverse().concat([["extra", "x"]]);
    const shuffled = Object.fromEntries(reversed) as SecretEnvelope;
    expect(Object.keys(shuffled)[0]).toBe("wrapNonce");
    expect(serializeEnvelope(shuffled)).toBe(GOLDEN);
    expect(Object.keys(parseEnvelope(GOLDEN))).toEqual([
      "v",
      "keyVersion",
      "nonce",
      "ciphertext",
      "tag",
      "wrappedDek",
      "wrapNonce",
    ]);
  });

  test("stored form is base64url text that fits a text column", () => {
    expect(GOLDEN).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(GOLDEN.length).toBeLessThan(1000);
  });

  test("envelopeFrom accepts strings and objects", () => {
    expect(envelopeFrom(GOLDEN)).toEqual(FIXTURE);
    expect(envelopeFrom(FIXTURE)).toEqual(FIXTURE);
  });
});

describe("envelope parsing rejects", () => {
  test("non-strings, empty, non-base64url and non-JSON input", () => {
    for (const bad of [
      undefined,
      null,
      42,
      "",
      "not base64url!",
      "%%%",
      toBase64Url(Buffer.from("{")),
    ]) {
      expectCode(() => parseEnvelope(bad), "malformed_envelope");
    }
  });

  test("JSON that is not an envelope object", () => {
    for (const bad of ["null", "[]", '"str"', "{}", '{"v":1}']) {
      expectCode(() => parseEnvelope(toBase64Url(Buffer.from(bad))), "malformed_envelope");
    }
  });

  test("unsupported envelope versions with a distinct code", () => {
    expectCode(
      () => envelopeFrom({ ...FIXTURE, v: 2 } as unknown as SecretEnvelope),
      "unsupported_envelope_version",
    );
    expectCode(
      () => envelopeFrom({ ...FIXTURE, v: "1" } as unknown as SecretEnvelope),
      "malformed_envelope",
    );
  });

  test("bad key versions", () => {
    for (const bad of [0, -1, 1.5, "1", Number.NaN, 2 ** 40]) {
      expectCode(
        () => envelopeFrom({ ...FIXTURE, keyVersion: bad } as SecretEnvelope),
        "malformed_envelope",
      );
    }
  });

  test("wrong byte lengths, empty ciphertext, padding and non-canonical encodings", () => {
    const cases: Array<Partial<Record<keyof SecretEnvelope, unknown>>> = [
      { nonce: toBase64Url(Buffer.alloc(11)) },
      { nonce: toBase64Url(Buffer.alloc(13)) },
      { tag: toBase64Url(Buffer.alloc(15)) },
      { wrappedDek: toBase64Url(Buffer.alloc(32)) },
      { wrapNonce: toBase64Url(Buffer.alloc(16)) },
      { ciphertext: "" },
      { ciphertext: "AQ==" },
      { ciphertext: "AQ+" },
      { ciphertext: "AR" },
      { nonce: 12 },
    ];
    for (const patch of cases) {
      expectCode(
        () => envelopeFrom({ ...FIXTURE, ...patch } as SecretEnvelope),
        "malformed_envelope",
      );
    }
  });
});

describe("helpers", () => {
  test("isKeyVersion", () => {
    expect(isKeyVersion(1)).toBe(true);
    expect(isKeyVersion(2 ** 31 - 1)).toBe(true);
    expect([0, -3, 1.2, "1", null, 2 ** 31].some(isKeyVersion)).toBe(false);
  });

  test("fromBase64Url enforces canonical form and length", () => {
    expect(fromBase64Url("AQID", 3)).toEqual(Buffer.from([1, 2, 3]));
    expectCode(() => fromBase64Url("AQID", 4), "malformed_envelope");
    expectCode(() => fromBase64Url("AQID=", 3), "malformed_envelope");
  });
});
