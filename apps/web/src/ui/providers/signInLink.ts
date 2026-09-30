/**
 * Finds the CLI's sign-in link in the login terminal (#156). Long URLs wrap
 * at the terminal width, so they are hard to select; the panel shows the link
 * above the terminal with Open and Copy instead.
 *
 * Client-side only: the buffer is read in the browser and never sent to the
 * server or logged. Only https links to the provider's own auth hosts count.
 */
import type { CliLoginProvider } from "@regulus/protocol";
import type { BufferLine } from "../terminal/host.ts";

/** Hosts each provider's CLI sends people to for its sign-in (exact host names). */
export const SIGN_IN_HOSTS: Record<CliLoginProvider, readonly string[]> = {
  "claude-code": ["claude.ai", "claude.com", "platform.claude.com", "console.anthropic.com"],
  codex: ["auth.openai.com", "chatgpt.com"],
};

/** Characters a URL may contain; anything else (space, quotes, box lines) ends it. */
const URL_CHAR = /[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]/;
/** A whole https URL (a URL inside another one's query is part of that one). */
const HTTPS_URL = /https:\/\/[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]+/g;
const TRAILING = /[.,;:!?)\]'"]+$/;

/**
 * Joins lines the terminal wrapped: xterm's soft wraps, and lines tmux drew
 * edge to edge (a full-width line whose last and next first cells are URL
 * characters continues on the next line).
 */
export function joinWrappedLines(lines: readonly BufferLine[], cols: number): string[] {
  const out: string[] = [];
  let prevFull = false;
  for (const line of lines) {
    const text = line.text;
    const last = out.length - 1;
    const continues =
      last >= 0 &&
      (line.wrapped ||
        (prevFull && URL_CHAR.test(text.charAt(0)) && URL_CHAR.test(out[last]?.slice(-1) ?? "")));
    if (continues) out[last] += text;
    else out.push(text);
    prevFull = text.length >= cols;
  }
  return out;
}

/** The link when it is https to one of `hosts` (no credentials, default port), else null. */
export function allowedSignInUrl(candidate: string, hosts: readonly string[]): string | null {
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
  return hosts.includes(url.hostname) ? url.href : null;
}

/** The newest allowed sign-in link in the buffer, or null. */
export function findSignInUrl(
  lines: readonly BufferLine[],
  cols: number,
  provider: CliLoginProvider,
): string | null {
  const hosts = SIGN_IN_HOSTS[provider];
  let found: string | null = null;
  for (const text of joinWrappedLines(lines, cols)) {
    for (const match of text.matchAll(HTTPS_URL)) {
      const allowed = allowedSignInUrl(match[0].replace(TRAILING, ""), hosts);
      if (allowed) found = allowed;
    }
  }
  return found;
}
