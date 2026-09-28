/**
 * Thin AES-256-GCM wrapper over node:crypto. Fixed 12-byte nonce, 16-byte tag.
 * Authentication failures are re-thrown as SecretsError so the node error
 * (and its stack) never reaches logs with any attached state.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { KEY_BYTES, NONCE_BYTES, TAG_BYTES } from "./envelope.ts";
import { SecretsError } from "./errors.ts";

const ALGORITHM = "aes-256-gcm";

export interface Sealed {
  readonly nonce: Buffer;
  readonly ciphertext: Buffer;
  readonly tag: Buffer;
}

/** Overwrites every buffer with zeros. Safe to call on empty buffers. */
export function zeroize(...buffers: readonly Uint8Array[]): void {
  for (const buffer of buffers) buffer.fill(0);
}

export function randomKey(): Buffer {
  return randomBytes(KEY_BYTES);
}

export function randomNonce(): Buffer {
  return randomBytes(NONCE_BYTES);
}

/** Encrypts `plaintext` under `key` with a fresh random nonce. Does not modify or zero `plaintext`. */
export function seal(key: Buffer, plaintext: Uint8Array, aad: string): Sealed {
  const nonce = randomNonce();
  const cipher = createCipheriv(ALGORITHM, key, nonce, { authTagLength: TAG_BYTES });
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { nonce, ciphertext, tag: cipher.getAuthTag() };
}

/**
 * Decrypts and authenticates. Returns a fresh Buffer the caller owns and
 * should `zeroize` once used. Throws `authentication_failed` on any mismatch.
 */
export function open(key: Buffer, sealed: Sealed, aad: string): Buffer {
  const decipher = createDecipheriv(ALGORITHM, key, sealed.nonce, { authTagLength: TAG_BYTES });
  decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(sealed.tag);
  const head = decipher.update(sealed.ciphertext);
  let tail: Buffer;
  try {
    tail = decipher.final();
  } catch {
    zeroize(head);
    throw new SecretsError("authentication_failed");
  }
  const plaintext = Buffer.concat([head, tail]);
  zeroize(head, tail);
  return plaintext;
}
