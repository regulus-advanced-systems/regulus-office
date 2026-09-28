/**
 * Master key material and keyrings.
 *
 * OFFICE_MASTER_KEY holds 32 random bytes as base64 (standard or url-safe,
 * padding optional) or 64 hex characters. Anything else is rejected with a
 * SecretsError whose message never echoes the value.
 *
 * A keyring maps key versions to keys so that secrets wrapped under older
 * versions stay readable during rotation.
 */

import { isKeyVersion, KEY_BYTES, type KeyVersion } from "./envelope.ts";
import { SecretsError } from "./errors.ts";

export type Keyring = Readonly<Record<KeyVersion, Buffer>>;

export interface MasterKeyring {
  /** Version used for new envelopes and as the rotation target. */
  readonly current: KeyVersion;
  readonly keys: Keyring;
}

export const MASTER_KEY_ENV = "OFFICE_MASTER_KEY";
export const MASTER_KEY_VERSION_ENV = "OFFICE_MASTER_KEY_VERSION";
export const MASTER_KEY_PREVIOUS_ENV = "OFFICE_MASTER_KEY_PREVIOUS";

const HEX_RE = /^[0-9a-fA-F]{64}$/;
const BASE64_RE = /^[A-Za-z0-9+/]{43}=?$/;
const BASE64URL_RE = /^[A-Za-z0-9_-]{43}=?$/;

/** Parses OFFICE_MASTER_KEY material into a 32-byte key. */
export function parseMasterKey(raw: unknown): Buffer {
  if (typeof raw !== "string") throw new SecretsError("invalid_master_key");
  const value = raw.trim();
  let key: Buffer;
  if (HEX_RE.test(value)) key = Buffer.from(value, "hex");
  else if (BASE64_RE.test(value)) key = Buffer.from(value, "base64");
  else if (BASE64URL_RE.test(value)) key = Buffer.from(value, "base64url");
  else throw new SecretsError("invalid_master_key");
  if (key.length !== KEY_BYTES) throw new SecretsError("invalid_master_key");
  return key;
}

export function parseKeyVersion(raw: unknown): KeyVersion {
  if (typeof raw === "number") {
    if (!isKeyVersion(raw)) throw new SecretsError("invalid_key_version");
    return raw;
  }
  if (typeof raw !== "string" || !/^[1-9][0-9]{0,9}$/.test(raw.trim())) {
    throw new SecretsError("invalid_key_version");
  }
  const version = Number(raw.trim());
  if (!isKeyVersion(version)) throw new SecretsError("invalid_key_version");
  return version;
}

export function lookupKey(keyring: Keyring, keyVersion: KeyVersion): Buffer {
  if (!isKeyVersion(keyVersion)) throw new SecretsError("invalid_key_version");
  const key = Object.hasOwn(keyring, keyVersion) ? keyring[keyVersion] : undefined;
  if (key === undefined || key.length !== KEY_BYTES) {
    throw new SecretsError("unknown_key_version", keyVersion);
  }
  return key;
}

function parsePreviousKeys(raw: string | undefined): Array<[KeyVersion, Buffer]> {
  if (raw === undefined || raw.trim() === "") return [];
  return raw.split(",").map((entry) => {
    const separator = entry.indexOf(":");
    if (separator <= 0) throw new SecretsError("invalid_previous_keys");
    return [parseKeyVersion(entry.slice(0, separator)), parseMasterKey(entry.slice(separator + 1))];
  });
}

/**
 * Builds a keyring from the environment:
 *   OFFICE_MASTER_KEY           current key (required)
 *   OFFICE_MASTER_KEY_VERSION   its version, default 1
 *   OFFICE_MASTER_KEY_PREVIOUS  optional `<version>:<key>,...` still needed to
 *                               read envelopes not yet rotated
 */
export function loadMasterKeyring(
  env: Readonly<Record<string, string | undefined>> = process.env,
): MasterKeyring {
  const current =
    env[MASTER_KEY_VERSION_ENV] === undefined ? 1 : parseKeyVersion(env[MASTER_KEY_VERSION_ENV]);
  const keys: Record<KeyVersion, Buffer> = { [current]: parseMasterKey(env[MASTER_KEY_ENV]) };
  for (const [version, key] of parsePreviousKeys(env[MASTER_KEY_PREVIOUS_ENV])) {
    if (Object.hasOwn(keys, version)) throw new SecretsError("invalid_key_version");
    keys[version] = key;
  }
  return { current, keys: Object.freeze(keys) };
}
