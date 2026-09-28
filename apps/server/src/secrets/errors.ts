/**
 * Errors thrown by the secrets module.
 *
 * Every message is a fixed string chosen by code. Nothing derived from
 * plaintext, key material or envelope contents is ever interpolated, so a
 * SecretsError is always safe to log or surface to an operator (SPEC §8).
 */

export type SecretsErrorCode =
  | "invalid_master_key"
  | "invalid_previous_keys"
  | "invalid_key_version"
  | "unknown_key_version"
  | "invalid_context"
  | "invalid_plaintext"
  | "malformed_envelope"
  | "unsupported_envelope_version"
  | "authentication_failed";

const MESSAGES: Readonly<Record<SecretsErrorCode, string>> = {
  invalid_master_key:
    "OFFICE_MASTER_KEY must be 32 random bytes encoded as base64 (43-44 chars) or hex (64 chars)",
  invalid_previous_keys:
    "OFFICE_MASTER_KEY_PREVIOUS must be a comma-separated list of <version>:<key> entries",
  invalid_key_version: "master key version must be a positive integer",
  unknown_key_version: "no master key in the keyring for the requested key version",
  invalid_context: "userId and secretName must be non-empty strings that do not contain '|'",
  invalid_plaintext: "plaintext must be a non-empty string or Buffer",
  malformed_envelope: "stored secret is not a well-formed envelope",
  unsupported_envelope_version:
    "stored secret uses an envelope version this server does not support",
  authentication_failed:
    "secret could not be authenticated (wrong master key, wrong userId/secretName, or tampered envelope)",
};

export class SecretsError extends Error {
  override readonly name = "SecretsError";
  readonly code: SecretsErrorCode;
  /** Present only for key-version lookups; versions are not secret. */
  readonly keyVersion: number | undefined;

  constructor(code: SecretsErrorCode, keyVersion?: number) {
    const suffix = keyVersion === undefined ? "" : ` (key version ${keyVersion})`;
    super(`${MESSAGES[code]}${suffix}`);
    this.code = code;
    this.keyVersion = keyVersion;
  }
}

export function isSecretsError(value: unknown): value is SecretsError {
  return value instanceof SecretsError;
}
