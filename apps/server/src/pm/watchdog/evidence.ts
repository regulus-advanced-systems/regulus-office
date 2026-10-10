/**
 * What the watchdog reads on a host is a production log: it can hold a key,
 * a password in a connection string, a bearer token. Nothing of a log line
 * is given to the model, stored or shown before it passed through here
 * (SPEC §8; #253).
 *
 * Unlike `redactText` (secrets/redact.ts), paths are kept: a stack trace
 * without its files is no evidence.
 */
import { REDACTED } from "../../secrets/index.ts";

const SENSITIVE_NAME = /secret|key|token|password|passwd|pwd|credential|auth|cookie|dsn/i;

const RULES: readonly [RegExp, string | ((...m: string[]) => string)][] = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, REDACTED],
  // Provider keys, GitHub tokens, office agent tokens, Sentry tokens, Slack tokens.
  [
    /\b(?:sk-[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9]{8,}|github_pat_[A-Za-z0-9_]{8,}|roa_[A-Za-z0-9_-]{8,}|sntry[su]_[A-Za-z0-9_=+/-]{8,}|xox[abprs]-[A-Za-z0-9-]{8,})/g,
    REDACTED,
  ],
  // user:password@ in a URL.
  [/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi, `$1${REDACTED}@`],
  // "Authorization: Bearer x", "password=x", "token: 'x'".
  [
    /\b(authorization|bearer|token|password|passwd|secret|api[_-]?key|cookie)\b(["']?\s*[:=]\s*["']?(?:bearer\s+|basic\s+)?|\s+)([^\s"',;]+)/gi,
    (_all, name, sep) => `${name}${sep}${REDACTED}`,
  ],
  // Env assignments whose name says it is a secret: keep the name, drop the value.
  [
    /\b([A-Z][A-Z0-9_]{1,63})=("[^"]*"|'[^']*'|\S*)/g,
    (all, name) => (SENSITIVE_NAME.test(name ?? "") ? `${name}=${REDACTED}` : (all ?? "")),
  ],
  // Long token-like runs that mix letters and digits (JWT parts, base64 blobs).
  [
    /[A-Za-z0-9+/_=-]{40,}/g,
    (all) => (/[A-Za-z]/.test(all ?? "") && /\d/.test(all ?? "") ? REDACTED : (all ?? "")),
  ],
];

/** One log line or a block of evidence with what must not be shown replaced. Idempotent. */
export function scrubEvidence(text: string): string {
  let out = text;
  for (const [re, to] of RULES) {
    out = typeof to === "string" ? out.replace(re, to) : out.replace(re, to as never);
  }
  return out;
}

/** Control characters out (a log can carry escape sequences), length capped. */
export function cleanLine(line: string, max = 300): string {
  const flat = line
    // ANSI colour and cursor sequences first, then any other control character.
    .replace(/\u001b\[[0-9;?]*[A-Za-z]/g, "")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")
    .trimEnd();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}
