/**
 * Links in a terminal (#156): only `http:` / `https:` URLs are ever opened,
 * always in a new tab with no opener and no referrer.
 */

/** The normalised URL when `uri` is an absolute http(s) URL, else null. */
export function safeHttpUrl(uri: string): string | null {
  let url: URL;
  try {
    url = new URL(uri.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  // Credentials in a link are never what a CLI means to show; refuse rather than guess.
  if (url.username || url.password) return null;
  return url.href;
}

export type OpenWindow = (url: string, target: string, features: string) => unknown;

/** Opens an http(s) link in a new tab (noopener, noreferrer); anything else is ignored. */
export function openExternalLink(
  uri: string,
  open: OpenWindow = (url, target, features) => window.open(url, target, features),
): boolean {
  const href = safeHttpUrl(uri);
  if (!href) return false;
  open(href, "_blank", "noopener,noreferrer");
  return true;
}
