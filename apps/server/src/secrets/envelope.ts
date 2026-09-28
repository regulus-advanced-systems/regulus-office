/**
 * Envelope format (v1) for an encrypted secret, and its stable text encoding.
 *
 * Layout (all byte fields base64url without padding):
 *   v          literal 1
 *   keyVersion positive integer; selects the master key that wrapped the DEK
 *   nonce      12 bytes, AES-256-GCM nonce for the data
 *   ciphertext data encrypted under the per-secret DEK
 *   tag        16 bytes, GCM tag for the data (AAD = `${userId}|${secretName}`)
 *   wrappedDek 48 bytes: the 32-byte DEK encrypted under the master key, GCM tag appended
 *   wrapNonce  12 bytes, AES-256-GCM nonce used to wrap the DEK
 *
 * The stored form is base64url(JSON) with the keys in the order above, so
 * `serializeEnvelope(parseEnvelope(s)) === s` and the value fits a text column.
 */

import { SecretsError } from "./errors.ts";

export const ENVELOPE_VERSION = 1 as const;
export const KEY_BYTES = 32;
export const NONCE_BYTES = 12;
export const TAG_BYTES = 16;
export const WRAPPED_DEK_BYTES = KEY_BYTES + TAG_BYTES;

/** Positive integer identifying a master key in a keyring. */
export type KeyVersion = number;

export interface SecretEnvelope {
  readonly v: typeof ENVELOPE_VERSION;
  readonly keyVersion: KeyVersion;
  readonly nonce: string;
  readonly ciphertext: string;
  readonly tag: string;
  readonly wrappedDek: string;
  readonly wrapNonce: string;
}

const MAX_KEY_VERSION = 2 ** 31 - 1;
const BASE64URL_RE = /^[A-Za-z0-9_-]*$/;

export function isKeyVersion(value: unknown): value is KeyVersion {
  return (
    typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= MAX_KEY_VERSION
  );
}

export function toBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64url");
}

/**
 * Decodes canonical, unpadded base64url. Throws `malformed_envelope` on any
 * other input, or when `expectedBytes` is given and the length differs.
 */
export function fromBase64Url(text: unknown, expectedBytes?: number): Buffer {
  if (typeof text !== "string" || !BASE64URL_RE.test(text)) {
    throw new SecretsError("malformed_envelope");
  }
  const bytes = Buffer.from(text, "base64url");
  if (bytes.toString("base64url") !== text) throw new SecretsError("malformed_envelope");
  if (expectedBytes !== undefined && bytes.length !== expectedBytes) {
    throw new SecretsError("malformed_envelope");
  }
  return bytes;
}

/** Validates an in-memory envelope and returns a frozen copy with canonical key order. */
export function validateEnvelope(value: unknown): SecretEnvelope {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new SecretsError("malformed_envelope");
  }
  const raw = value as Record<string, unknown>;
  if (raw.v !== ENVELOPE_VERSION) {
    throw new SecretsError(
      isKeyVersion(raw.v) ? "unsupported_envelope_version" : "malformed_envelope",
    );
  }
  if (!isKeyVersion(raw.keyVersion)) throw new SecretsError("malformed_envelope");
  fromBase64Url(raw.nonce, NONCE_BYTES);
  if (fromBase64Url(raw.ciphertext).length === 0) throw new SecretsError("malformed_envelope");
  fromBase64Url(raw.tag, TAG_BYTES);
  fromBase64Url(raw.wrappedDek, WRAPPED_DEK_BYTES);
  fromBase64Url(raw.wrapNonce, NONCE_BYTES);
  return Object.freeze({
    v: ENVELOPE_VERSION,
    keyVersion: raw.keyVersion,
    nonce: raw.nonce as string,
    ciphertext: raw.ciphertext as string,
    tag: raw.tag as string,
    wrappedDek: raw.wrappedDek as string,
    wrapNonce: raw.wrapNonce as string,
  });
}

/** Encodes an envelope to the compact text form stored in `credential_profiles.encryptedSecret`. */
export function serializeEnvelope(envelope: SecretEnvelope): string {
  const canonical = validateEnvelope(envelope);
  return Buffer.from(JSON.stringify(canonical), "utf8").toString("base64url");
}

/** Decodes the stored text form. Throws SecretsError; never echoes the input. */
export function parseEnvelope(text: unknown): SecretEnvelope {
  if (typeof text !== "string" || text.length === 0 || !BASE64URL_RE.test(text)) {
    throw new SecretsError("malformed_envelope");
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(text, "base64url").toString("utf8"));
  } catch {
    throw new SecretsError("malformed_envelope");
  }
  return validateEnvelope(decoded);
}

/** Accepts either the stored text form or an already-parsed envelope. */
export function envelopeFrom(input: string | SecretEnvelope): SecretEnvelope {
  return typeof input === "string" ? parseEnvelope(input) : validateEnvelope(input);
}
