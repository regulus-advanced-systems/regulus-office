/**
 * redact(): make values safe for structured logs.
 *
 * - A string or byte buffer passed directly becomes "[redacted]" (never a
 *   prefix, suffix or hash: SPEC §8 says keys are never shown after entry).
 * - An object or array is deep-copied; values under sensitive-looking keys and
 *   any byte buffers are replaced, other strings (userId, provider, ...) pass
 *   through so the log line stays useful. Cycles and excessive depth are cut.
 * - Errors keep their name; only SecretsError messages are trusted verbatim.
 *
 * redactText(): make one piece of free text safe to show to other people (a
 * henchman's status reason, the bubble over its head). Unlike redact() it
 * keeps the sentence and replaces only what must not be shown.
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

/** Provider keys and GitHub tokens, whatever surrounds them. */
const PROVIDER_KEY = "\\b(?:sk-[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9]{8,}|github_pat_[A-Za-z0-9_]{8,})";
/** Env assignments: a name in capitals, `=`, a value. */
const ENV_ASSIGNMENT = "\\b([A-Z][A-Z0-9_]{1,63})=(\"[^\"]*\"|'[^']*'|\\S*)";
/** Long token-like runs: keys, container and exec ids, base64 blobs. */
const TOKEN_RUN = "[A-Za-z0-9+/_=-]{32,}";

const TEXT_RULES: readonly [RegExp, string][] = [
  [new RegExp(PROVIDER_KEY, "g"), REDACTED],
  // Keep the name, drop the value.
  [new RegExp(ENV_ASSIGNMENT, "g"), `$1=${REDACTED}`],
  // Absolute and home-relative paths (workdirs, mounts, HOME, sockets, API paths).
  [/(^|[\s'"`(=:,[])(?:~|\.{1,2})?\/[^\s'"`),;:\]]*/g, "$1<path>"],
  [new RegExp(TOKEN_RUN, "g"), REDACTED],
];

/**
 * Free text with credentials, env values, paths and token-like runs replaced
 * (SPEC §8). Idempotent: text that is already safe passes through unchanged.
 */
export function redactText(text: string): string {
  let out = text;
  for (const [re, to] of TEXT_RULES) out = out.replace(re, to);
  return out;
}

export type SecretLikeKind = "provider_key" | "office_token" | "private_key" | "env_secret" | "token";

const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

/**
 * Does text that is about to be *stored* (an agent's soul, a memory, a note;
 * #136) look like it holds a secret? The same patterns `redactText` hides in
 * what is shown, used the other way round: such text is refused, not kept.
 *
 * - provider keys and GitHub tokens, as above; office agent tokens; private key blocks;
 * - an env assignment whose name says it is a secret (`API_KEY=...`,
 *   `DB_PASSWORD=...`); `PORT=3000` is fine;
 * - a token-like run of 32 or more characters that mixes letters and digits.
 *   UUIDs (the office's own ids) are not secrets and pass; a row of dashes
 *   or equals signs is a markdown rule, not a token; a path or a link is
 *   judged by its parts between slashes.
 *
 * Paths, which `redactText` also hides, are not secrets and are kept.
 * Returns the kind and the 1-based line, never the matched text.
 */
export function findSecretLike(text: string): { kind: SecretLikeKind; line: number } | null {
  const lineAt = (index: number) => text.slice(0, index).split("\n").length;
  const first = (re: RegExp, accept: (m: RegExpExecArray) => boolean = () => true) => {
    for (const m of text.matchAll(re)) if (accept(m)) return m.index;
    return -1;
  };
  const checks: Array<[SecretLikeKind, number]> = [
    ["provider_key", first(new RegExp(PROVIDER_KEY, "g"))],
    ["office_token", first(/\broa_[A-Za-z0-9_-]{8,}/g)],
    ["private_key", first(/-----BEGIN [A-Z ]*PRIVATE KEY-----/g)],
    [
      "env_secret",
      first(new RegExp(ENV_ASSIGNMENT, "g"), (m) => {
        const value = (m[2] ?? "").replace(/^["']|["']$/g, "");
        return SENSITIVE_KEY_RE.test(m[1] ?? "") && value.length > 0;
      }),
    ],
    [
      "token",
      first(new RegExp(TOKEN_RUN, "g"), (m) => {
        const run = m[0].replace(UUID, "");
        const tokenLike = (v: string) => v.length >= 32 && /[A-Za-z]/.test(v) && /[0-9]/.test(v);
        // A slash usually means a path or a link: judge its parts, unless base64 signs say otherwise.
        return /[+=]/.test(run) ? tokenLike(run) : run.split("/").some(tokenLike);
      }),
    ],
  ];
  for (const [kind, index] of checks) if (index >= 0) return { kind, line: lineAt(index) };
  return null;
}
