/**
 * encryptSecret / decryptSecret: envelope encryption of one credential.
 *
 * Per secret: random 32-byte DEK; AES-256-GCM over the plaintext with
 * AAD = `${userId}|${secretName}` (SPEC §8, research 01 §8); DEK wrapped
 * under the master key selected by keyVersion. Plaintext buffers created
 * here are zeroed before returning.
 */

import { open, randomKey, seal, zeroize } from "./aead.ts";
import { unwrapDek, wrapDek } from "./dek.ts";
import {
  ENVELOPE_VERSION,
  envelopeFrom,
  fromBase64Url,
  type KeyVersion,
  NONCE_BYTES,
  type SecretEnvelope,
  serializeEnvelope,
  TAG_BYTES,
  toBase64Url,
  WRAPPED_DEK_BYTES,
} from "./envelope.ts";
import { SecretsError } from "./errors.ts";
import { type Keyring, lookupKey } from "./master-key.ts";

/** Binds a ciphertext to its owner and purpose. Both parts are non-secret identifiers. */
export interface SecretContext {
  readonly userId: string;
  readonly secretName: string;
}

function isContextPart(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && !value.includes("|");
}

export function dataAad(context: SecretContext): string {
  if (!isContextPart(context.userId) || !isContextPart(context.secretName)) {
    throw new SecretsError("invalid_context");
  }
  return `${context.userId}|${context.secretName}`;
}

/**
 * Encrypts `plaintext` for `context` under keyring[keyVersion] and returns the
 * serialised envelope. When `plaintext` is a Buffer the caller keeps ownership
 * and should zero it; a string input is copied and the copy is zeroed.
 */
export function encryptSecret(
  plaintext: string | Uint8Array,
  context: SecretContext,
  keyring: Keyring,
  keyVersion: KeyVersion,
): string {
  const aad = dataAad(context);
  const masterKey = lookupKey(keyring, keyVersion);
  const ownsCopy = typeof plaintext === "string";
  const bytes = ownsCopy ? Buffer.from(plaintext, "utf8") : plaintext;
  if (bytes.length === 0) throw new SecretsError("invalid_plaintext");
  const dek = randomKey();
  try {
    const data = seal(dek, bytes, aad);
    const wrapped = wrapDek(dek, masterKey, keyVersion);
    const envelope: SecretEnvelope = {
      v: ENVELOPE_VERSION,
      keyVersion,
      nonce: toBase64Url(data.nonce),
      ciphertext: toBase64Url(data.ciphertext),
      tag: toBase64Url(data.tag),
      wrappedDek: toBase64Url(wrapped.wrappedDek),
      wrapNonce: toBase64Url(wrapped.wrapNonce),
    };
    return serializeEnvelope(envelope);
  } finally {
    zeroize(dek);
    if (ownsCopy) zeroize(bytes);
  }
}

/**
 * Decrypts a stored envelope for `context`. Returns a fresh Buffer that the
 * caller owns and must `zeroize` after injecting it into the agent's env.
 */
export function decryptSecret(
  input: string | SecretEnvelope,
  context: SecretContext,
  keyring: Keyring,
): Buffer {
  const aad = dataAad(context);
  const envelope = envelopeFrom(input);
  const masterKey = lookupKey(keyring, envelope.keyVersion);
  const dek = unwrapDek(
    {
      wrappedDek: fromBase64Url(envelope.wrappedDek, WRAPPED_DEK_BYTES),
      wrapNonce: fromBase64Url(envelope.wrapNonce, NONCE_BYTES),
    },
    masterKey,
    envelope.keyVersion,
  );
  try {
    return open(
      dek,
      {
        nonce: fromBase64Url(envelope.nonce, NONCE_BYTES),
        ciphertext: fromBase64Url(envelope.ciphertext),
        tag: fromBase64Url(envelope.tag, TAG_BYTES),
      },
      aad,
    );
  } finally {
    zeroize(dek);
  }
}

/** Convenience for callers that need a string (env injection). Strings cannot be zeroed. */
export function decryptSecretToString(
  input: string | SecretEnvelope,
  context: SecretContext,
  keyring: Keyring,
): string {
  const bytes = decryptSecret(input, context, keyring);
  try {
    return bytes.toString("utf8");
  } finally {
    zeroize(bytes);
  }
}
