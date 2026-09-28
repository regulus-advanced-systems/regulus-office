/**
 * Master-key rotation: re-wrap the DEK under another key version.
 * The data nonce, ciphertext and tag are copied through untouched, so the
 * secret's plaintext is never decrypted during rotation.
 */

import { zeroize } from "./aead.ts";
import { unwrapDek, wrapDek } from "./dek.ts";
import {
  envelopeFrom,
  fromBase64Url,
  type KeyVersion,
  NONCE_BYTES,
  type SecretEnvelope,
  serializeEnvelope,
  toBase64Url,
  WRAPPED_DEK_BYTES,
} from "./envelope.ts";
import { type Keyring, lookupKey } from "./master-key.ts";

/**
 * Returns a new serialised envelope whose DEK is wrapped under
 * `keyring[toVersion]`. `keyring` must also hold the envelope's current key
 * version. Rotating to the same version re-wraps with a fresh nonce.
 */
export function rotateEnvelope(
  input: string | SecretEnvelope,
  keyring: Keyring,
  toVersion: KeyVersion,
): string {
  const envelope = envelopeFrom(input);
  const fromKey = lookupKey(keyring, envelope.keyVersion);
  const toKey = lookupKey(keyring, toVersion);
  const dek = unwrapDek(
    {
      wrappedDek: fromBase64Url(envelope.wrappedDek, WRAPPED_DEK_BYTES),
      wrapNonce: fromBase64Url(envelope.wrapNonce, NONCE_BYTES),
    },
    fromKey,
    envelope.keyVersion,
  );
  try {
    const wrapped = wrapDek(dek, toKey, toVersion);
    return serializeEnvelope({
      ...envelope,
      keyVersion: toVersion,
      wrappedDek: toBase64Url(wrapped.wrappedDek),
      wrapNonce: toBase64Url(wrapped.wrapNonce),
    });
  } finally {
    zeroize(dek);
  }
}
