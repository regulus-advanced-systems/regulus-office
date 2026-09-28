/**
 * redact(): make values safe for structured logs.
 *
 * - A string or byte buffer passed directly becomes "[redacted]" (never a
 *   prefix, suffix or hash: SPEC §8 says keys are never shown after entry).
 * - An object or array is deep-copied; values under sensitive-looking keys and
 *   any byte buffers are replaced, other strings (userId, provider, ...) pass
 *   through so the log line stays useful. Cycles and excessive depth are cut.
 * - Errors keep their name; only SecretsError messages are trusted verbatim.
 */

import { isSecretsError } from "./errors.ts";

export const REDACTED = "[redacted]";

const SENSITIVE_KEY_RE =
  /secret|key|token|password|passwd|credential|dek|ciphertext|nonce|authorization|cookie|envelope/i;
/** Keys matching SENSITIVE_KEY_RE that are nevertheless safe to log. */
const ALLOWED_KEYS: ReadonlySet<string> = new Set(["keyVersion"]);
const MAX_DEPTH = 8;

function isBytes(value: unknown): boolean {
  return value instanceof Uint8Array || value instanceof ArrayBuffer;
}

function redactError(error: Error): Record<string, unknown> {
  const out: Record<string, unknown> = { name: error.name };
  if (isSecretsError(error)) {
    out.message = error.message;
    out.code = error.code;
    if (error.keyVersion !== undefined) out.keyVersion = error.keyVersion;
  } else {
    out.message = REDACTED;
  }
  return out;
}

function walk(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (isBytes(value) || (typeof value === "string" && depth === 0)) return REDACTED;
  if (value === null || typeof value !== "object") {
    return typeof value === "function" || typeof value === "symbol" ? undefined : value;
  }
  if (value instanceof Error) return redactError(value);
  if (value instanceof Date) return value.toISOString();
  if (seen.has(value)) return "[circular]";
  if (depth >= MAX_DEPTH) return "[depth]";
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => walk(item, depth + 1, seen));
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    const sensitive = SENSITIVE_KEY_RE.test(key) && !ALLOWED_KEYS.has(key);
    out[key] = sensitive ? REDACTED : walk(item, depth + 1, seen);
  }
  return out;
}

export function redact(value: string | Uint8Array | ArrayBuffer): string;
export function redact(value: unknown): unknown;
export function redact(value: unknown): unknown {
  return walk(value, 0, new WeakSet());
}
