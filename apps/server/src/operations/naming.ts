/**
 * Operation slugs and repo directory names. Both end up in filesystem paths
 * (`<projectsDir>/<operation-slug>/<repo>`, SPEC §8), so they are restricted to
 * a safe character set here rather than trusted from input.
 */
import type { RepoRef } from "../github/repo-ref.ts";

const MAX_SLUG = 48;
/** Slugs that would clash with the lobby or read as path tricks. */
const RESERVED = new Set(["lobby", "new", "archive"]);

/** `"Apollo Moon!"` → `"apollo-moon"`; never empty, never reserved. */
export function slugify(name: string): string {
  const base = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG)
    .replace(/-+$/g, "");
  if (!base) return "operation";
  return RESERVED.has(base) ? `${base}-operation` : base;
}

/** First of `base`, `base-2`, `base-3`, ... not in `taken`. */
export function uniqueSlug(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const suffix = `-${n}`;
    const candidate = `${base.slice(0, MAX_SLUG - suffix.length)}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/**
 * Directory for each repo inside the operation dir: the repo name, or
 * `<owner>-<name>` when two repos on the operation share a name. Repo names are
 * already limited to `[A-Za-z0-9._-]` and never `.`/`..` (see repo-ref.ts).
 */
export function repoDirNames(refs: readonly RepoRef[]): string[] {
  const counts = new Map<string, number>();
  for (const r of refs)
    counts.set(r.name.toLowerCase(), (counts.get(r.name.toLowerCase()) ?? 0) + 1);
  return refs.map((r) =>
    (counts.get(r.name.toLowerCase()) ?? 0) > 1 ? `${r.owner}-${r.name}` : r.name,
  );
}
