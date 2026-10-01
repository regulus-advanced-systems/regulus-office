/**
 * GitHub repo references for operations (SPEC §5 `operation_repos`, D7): parse what
 * an admin typed (`owner/name` or an https GitHub URL) into owner + name,
 * and build the public web URL and the clone remote from it.
 *
 * URLs carrying credentials (`https://user:token@github.com/...`) are
 * rejected: a token goes in the separate credential field so it is stored
 * encrypted and never ends up in a remote URL on disk (SPEC §8).
 */

export interface RepoRef {
  owner: string;
  name: string;
}

/** GitHub account names: alphanumerics and single hyphens, up to 39 characters. */
const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
/** GitHub repo names: letters, digits, `.`, `_`, `-`; up to 100 characters. */
const NAME_RE = /^[A-Za-z0-9._-]{1,100}$/;
const GITHUB_HOSTS = new Set(["github.com", "www.github.com"]);

export type RepoRefError = "invalid_repo" | "unsupported_host" | "credentials_in_url";

export type RepoRefResult = { ok: true; ref: RepoRef } | { ok: false; error: RepoRefError };

function fromParts(owner: string | undefined, rawName: string | undefined): RepoRefResult {
  const name = rawName?.replace(/\.git$/i, "");
  if (!owner || !name || !OWNER_RE.test(owner) || !NAME_RE.test(name)) {
    return { ok: false, error: "invalid_repo" };
  }
  if (name === "." || name === "..") return { ok: false, error: "invalid_repo" };
  return { ok: true, ref: { owner, name } };
}

/** Parse `owner/name`, `https://github.com/owner/name`, with or without `.git` or a trailing slash. */
export function parseRepoRef(input: string): RepoRefResult {
  const text = input.trim();
  if (/^[a-z][a-z0-9+.-]*:/i.test(text)) {
    let url: URL;
    try {
      url = new URL(text);
    } catch {
      return { ok: false, error: "invalid_repo" };
    }
    if (url.username || url.password) return { ok: false, error: "credentials_in_url" };
    if (url.protocol !== "https:" || !GITHUB_HOSTS.has(url.hostname.toLowerCase())) {
      return { ok: false, error: "unsupported_host" };
    }
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length !== 2) return { ok: false, error: "invalid_repo" };
    return fromParts(parts[0], parts[1]);
  }
  const parts = text.replace(/\/+$/, "").split("/");
  if (parts.length !== 2) return { ok: false, error: "invalid_repo" };
  return fromParts(parts[0], parts[1]);
}

/** Public web URL shown to clients and stored in `operation_repos.url`. */
export function repoWebUrl(ref: RepoRef): string {
  return `https://github.com/${ref.owner}/${ref.name}`;
}

/** Clone remote under `base` (`https://github.com` in production, a local path in tests). */
export function repoRemoteUrl(base: string, ref: RepoRef): string {
  return `${base.replace(/\/+$/, "")}/${ref.owner}/${ref.name}.git`;
}

/** Case-insensitive identity of a repo (GitHub names are case-insensitive). */
export function repoKey(ref: RepoRef): string {
  return `${ref.owner.toLowerCase()}/${ref.name.toLowerCase()}`;
}
