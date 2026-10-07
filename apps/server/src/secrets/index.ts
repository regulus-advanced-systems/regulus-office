/**
 * Envelope encryption for credential_profiles.encryptedSecret (SPEC §5, §8).
 *
 * Usage:
 *   const ring = loadMasterKeyring();                       // from OFFICE_MASTER_KEY
 *   const stored = encryptSecret(apiKey, ctx, ring.keys, ring.current);
 *   const bytes = decryptSecret(stored, ctx, ring.keys);   // at spawn time only
 *   ... inject, then zeroize(bytes)
 *   const rotated = rotateEnvelope(stored, ring.keys, ring.current);
 */

export { zeroize } from "./aead.ts";
export {
  ENVELOPE_VERSION,
  envelopeFrom,
  isKeyVersion,
  KEY_BYTES,
  type KeyVersion,
  NONCE_BYTES,
  parseEnvelope,
  type SecretEnvelope,
  serializeEnvelope,
  TAG_BYTES,
  validateEnvelope,
  WRAPPED_DEK_BYTES,
} from "./envelope.ts";
export { isSecretsError, SecretsError, type SecretsErrorCode } from "./errors.ts";
export {
  type Keyring,
  loadMasterKeyring,
  lookupKey,
  MASTER_KEY_ENV,
  MASTER_KEY_PREVIOUS_ENV,
  MASTER_KEY_VERSION_ENV,
  type MasterKeyring,
  parseKeyVersion,
  parseMasterKey,
} from "./master-key.ts";
export { REDACTED, redact, redactText } from "./redact.ts";
export { rotateEnvelope } from "./rotate.ts";
export {
  decryptSecret,
  decryptSecretToString,
  encryptSecret,
  type SecretContext,
} from "./secret.ts";
