/**
 * Secret scrubbing for workflow output (#155 review). The robot's env holds
 * the office's model key and it reads attacker-written text, so a PR can ask
 * it to print `/proc/self/environ` into its review. Nothing a robot wrote
 * reaches GitHub, the run log or a preview before passing through here.
 *
 * - Exact secrets of the run (the office key, the installation token): plain,
 *   with invisible characters or whitespace inserted between the characters,
 *   base64 (standard and URL-safe, at every byte alignment), URL-encoded and
 *   hex.
 * - Generic provider key shapes (Anthropic, OpenAI, GitHub, Google), also
 *   inside base64 runs and URL-decoded text.
 *
 * `find` reports only what kind of secret matched, never the value.
 */

/** Zero-width and other invisible characters a robot could use to split a key. */
const INVISIBLE = /[­͏؜ᅟᅠ឴឵᠎​-‏‪-‮⁠-⁯ㅤ︀-️﻿ﾠ]/g;

export const KEY_SHAPES: readonly { kind: string; re: RegExp }[] = [
  { kind: "anthropic_key", re: /sk-ant-[A-Za-z0-9_-]{16,}/ },
  { kind: "openai_key", re: /\bsk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}/ },
  { kind: "github_token", re: /\bgh[pousr]_[A-Za-z0-9]{20,}/ },
  { kind: "github_pat", re: /\bgithub_pat_[A-Za-z0-9_]{20,}/ },
  { kind: "google_key", re: /\bAIza[0-9A-Za-z_-]{30,}/ },
];

const MIN_SECRET = 8;
const B64_RUN = /[A-Za-z0-9+/_-]{16,}={0,2}/g;

function b64(bytes: Buffer, url: boolean): string {
  const s = bytes.toString(url ? "base64url" : "base64");
  return url ? s : s.replace(/=+$/, "");
}

/**
 * The part of base64(prefix + secret) that depends only on the secret, for
 * each of the three byte alignments: an encoded secret anywhere in a longer
 * base64 blob contains one of these.
 */
export function base64Forms(secret: string): string[] {
  const bytes = Buffer.from(secret, "utf8");
  const out = new Set<string>();
  for (const url of [false, true]) {
    for (let k = 0; k < 3; k += 1) {
      const enc = b64(Buffer.concat([Buffer.alloc(k), bytes]), url);
      // Skip the characters that mix the padding bytes in, and the unstable tail.
      const start = k === 0 ? 0 : k === 1 ? 2 : 3;
      const stableEnd = Math.floor(((k + bytes.length) * 4) / 3) - 1;
      const mid = enc.slice(start, Math.max(start, stableEnd));
      if (mid.length >= 8) out.add(mid);
    }
  }
  return [...out];
}

function tryDecode(run: string): string[] {
  const out: string[] = [];
  for (const enc of ["base64", "base64url"] as const) {
    try {
      const text = Buffer.from(run, enc).toString("latin1");
      if (text.length > 0) out.push(text);
    } catch {
      // not decodable
    }
  }
  return out;
}

function urlDecoded(text: string): string | null {
  if (!/%[0-9a-f]{2}/i.test(text)) return null;
  try {
    return decodeURIComponent(text.replace(/\+/g, " "));
  } catch {
    return text.replace(/%([0-9a-f]{2})/gi, (_m, h: string) =>
      String.fromCharCode(parseInt(h, 16)),
    );
  }
}

export interface SecretMatch {
  /** `run_secret:<name>` or a generic shape such as `anthropic_key`. */
  kind: string;
}

export class SecretScrubber {
  readonly #secrets: { name: string; value: string; forms: string[] }[] = [];

  constructor(secrets: Readonly<Record<string, string | null | undefined>> = {}) {
    for (const [name, value] of Object.entries(secrets)) {
      if (!value || value.length < MIN_SECRET) continue;
      const hex = Buffer.from(value, "utf8").toString("hex");
      const forms = [
        value,
        encodeURIComponent(value),
        hex,
        hex.toUpperCase(),
        ...base64Forms(value),
      ];
      this.#secrets.push({ name, value, forms });
    }
  }

  /** Variants of the text in which a hidden secret shows up in the clear. */
  #views(text: string): string[] {
    const plain = text.normalize("NFKC").replace(INVISIBLE, "");
    const views = [text, plain, plain.replace(/\s+/g, "")];
    const url = urlDecoded(plain);
    if (url) views.push(url, url.replace(/\s+/g, ""));
    for (const run of plain.replace(/\s+/g, "").match(B64_RUN) ?? []) views.push(...tryDecode(run));
    return views;
  }

  /** The first secret in `text`, or null. */
  find(text: string): SecretMatch | null {
    if (!text) return null;
    const views = this.#views(text);
    for (const s of this.#secrets) {
      if (views.some((v) => s.forms.some((f) => v.includes(f))))
        return { kind: `run_secret:${s.name}` };
    }
    for (const shape of KEY_SHAPES) {
      if (views.some((v) => shape.re.test(v))) return { kind: shape.kind };
    }
    return null;
  }

  /** `text` with exact secrets and key shapes replaced (for logs and previews). */
  redact(text: string): string {
    let out = text;
    for (const s of this.#secrets) for (const f of s.forms) out = out.split(f).join("[redacted]");
    for (const shape of KEY_SHAPES)
      out = out.replace(new RegExp(shape.re.source, "g"), "[redacted]");
    // A hidden form still left over: drop the whole text rather than keep it.
    return this.find(out) ? "[redacted: contained a secret]" : out;
  }
}
