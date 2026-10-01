/**
 * What goes into the search index (#41): terminal text with escape
 * sequences and control characters removed, and anything that looks like a
 * credential replaced by `[redacted]`.
 *
 * Scrollback snapshots are captured as plain text (`capture-pane` without
 * `-e`), but chat and older snapshots may still carry escapes, and a henchman
 * may print a token it was given. The terminal itself masks nothing (its
 * viewers see exactly what the henchman printed), so the index is stricter than
 * the terminal: a search result must never be a way to fish for keys across
 * the whole office (SPEC §8). The scrubber is pattern based and therefore
 * best effort; see the PR notes for what it cannot catch.
 */

export const REDACTED = "[redacted]";

/**
 * Escape sequences, in order: OSC (to BEL or ST), DCS/SOS/PM/APC strings (to
 * ST), CSI (7-bit and 8-bit introducer) and the remaining two-or-more byte
 * ESC sequences (charset selection, keypad modes, RIS, ...).
 */
const ESCAPES = new RegExp(
  [
    "\\x1b\\][\\s\\S]*?(?:\\x07|\\x1b\\\\|$)",
    "\\x1b[PX^_][\\s\\S]*?(?:\\x1b\\\\|$)",
    "(?:\\x1b\\[|\\x9b)[\\x30-\\x3f]*[\\x20-\\x2f]*[\\x40-\\x7e]?",
    "\\x1b[\\x20-\\x2f]*[\\x30-\\x7e]?",
  ].join("|"),
  "g",
);

/** C0 controls except tab and newline, DEL and the C1 range. */
const CONTROLS = /[\x00-\x08\x0b-\x1f\x7f-\x9f]/g;

/** Apply backspaces and carriage returns the way a terminal line would show them. */
function settleLine(line: string): string {
  let text = line;
  if (text.includes("\r")) {
    // Each \r restarts the line; later text overwrites earlier text from column 0.
    let out = "";
    for (const part of text.split("\r")) out = part + out.slice(part.length);
    text = out;
  }
  if (text.includes("\b")) {
    const chars: string[] = [];
    for (const ch of text) {
      if (ch === "\b") chars.pop();
      else chars.push(ch);
    }
    text = chars.join("");
  }
  return text;
}

/** Plain text of terminal output: no escape sequences, no controls, lines settled. */
export function stripAnsi(input: string): string {
  const noEscapes = input.replace(ESCAPES, "");
  return noEscapes
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => settleLine(line).replace(CONTROLS, ""))
    .join("\n");
}

/** Token shapes that are credentials on their own. */
const TOKEN_PATTERNS: readonly RegExp[] = [
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/g,
  /\bsk-ant-[A-Za-z0-9_-]{16,}/g,
  /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bglpat-[A-Za-z0-9_-]{20,}/g,
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\bAIza[0-9A-Za-z_-]{30,}/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
  /\bnpm_[A-Za-z0-9]{30,}/g,
  /\b[Bb]earer\s+[A-Za-z0-9._~+/-]{12,}=*/g,
];

/** `NAME=value` / `name: value` where the name says it is a secret. */
const ASSIGNMENT =
  /\b([A-Za-z0-9_.-]*(?:secret|token|passwd|password|api[_-]?key|access[_-]?key|private[_-]?key|credential|authorization)[A-Za-z0-9_.-]*)(["']?\s*[=:]\s*)(["']?)(?![\d.,]+(?![^\s"'`,;]))([^\s"'`,;]{6,})/gi;

/** Credentials embedded in URLs: `scheme://user:pass@host`. */
const URL_USERINFO = /(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi;

/** Replace anything that looks like a credential with `[redacted]`. */
export function scrubSecrets(input: string): string {
  let text = input;
  for (const pattern of TOKEN_PATTERNS) text = text.replace(pattern, REDACTED);
  text = text.replace(URL_USERINFO, `$1${REDACTED}@`);
  text = text.replace(ASSIGNMENT, (whole, name: string, sep: string, quote: string, value) =>
    value === REDACTED ? whole : `${name}${sep}${quote}${REDACTED}`,
  );
  return text;
}

/** Terminal or chat text as it is stored in the index. */
export function indexableText(input: string): string {
  return scrubSecrets(stripAnsi(input));
}
