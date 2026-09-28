/**
 * Wrapping of the per-secret data-encryption key (DEK) under a master key.
 *
 * The wrap AAD is domain-separated and includes the key version, so a wrapped
 * DEK cannot be replayed under a different master-key version or reused as
 * data ciphertext. It deliberately excludes userId/secretName so rotation can
 * re-wrap a DEK without the secret's context; the data layer binds those.
 */

import { open, seal, zeroize } from "./aead.ts";
import { KEY_BYTES, type KeyVersion, TAG_BYTES } from "./envelope.ts";
import { SecretsError } from "./errors.ts";

export interface WrappedDek {
  /** 32 bytes of wrapped DEK followed by the 16-byte GCM tag. */
  readonly wrappedDek: Buffer;
  readonly wrapNonce: Buffer;
}

export function wrapAad(keyVersion: KeyVersion): string {
  return `regulus-office/secrets/v1/dek|${keyVersion}`;
}

export function wrapDek(dek: Buffer, masterKey: Buffer, keyVersion: KeyVersion): WrappedDek {
  const sealed = seal(masterKey, dek, wrapAad(keyVersion));
  return { wrappedDek: Buffer.concat([sealed.ciphertext, sealed.tag]), wrapNonce: sealed.nonce };
}

/** Returns the DEK; the caller must `zeroize` it after use. */
export function unwrapDek(wrapped: WrappedDek, masterKey: Buffer, keyVersion: KeyVersion): Buffer {
  if (wrapped.wrappedDek.length !== KEY_BYTES + TAG_BYTES) {
    throw new SecretsError("malformed_envelope");
  }
  const ciphertext = wrapped.wrappedDek.subarray(0, KEY_BYTES);
  const tag = wrapped.wrappedDek.subarray(KEY_BYTES);
  const dek = open(masterKey, { nonce: wrapped.wrapNonce, ciphertext, tag }, wrapAad(keyVersion));
  if (dek.length !== KEY_BYTES) {
    zeroize(dek);
    throw new SecretsError("authentication_failed");
  }
  return dek;
}
