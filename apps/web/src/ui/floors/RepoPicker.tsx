/**
 * Searchable multi-select of the repos the office GitHub connection can see
 * (#141), for "Add floor". Each row shows the name, private or public, the
 * default branch and the last push. Selection order is kept: the first repo
 * picked becomes the floor's primary repo. Plain checkboxes, so it works from
 * the keyboard and with screen readers.
 */
import type { GitHubRepoInfo } from "@regulus/protocol";
import { useId, useMemo, useState } from "react";

/** Rows rendered at once; searching narrows the rest. */
export const MAX_SHOWN_REPOS = 200;

/** Case-insensitive match on `owner/name` and the description. */
export function filterRepos(repos: readonly GitHubRepoInfo[], query: string): GitHubRepoInfo[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...repos];
  return repos.filter(
    (r) => r.fullName.toLowerCase().includes(q) || r.description?.toLowerCase().includes(q),
  );
}

/** "today", "3 days ago", "2 months ago"… for the last push. */
export function pushedAgo(pushedAt: number | null, now = Date.now()): string {
  if (pushedAt === null) return "never pushed";
  const days = Math.floor((now - pushedAt) / 86_400_000);
  if (days <= 0) return "pushed today";
  if (days === 1) return "pushed yesterday";
  if (days < 60) return `pushed ${days} days ago`;
  const months = Math.floor(days / 30);
  if (months < 24) return `pushed ${months} months ago`;
  return `pushed ${Math.floor(months / 12)} years ago`;
}

export function RepoPicker({
  repos,
  selected,
  onChange,
  disabled,
}: {
  repos: readonly GitHubRepoInfo[];
  /** Picked `owner/name`s in the order they were picked. */
  selected: readonly string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState("");
  const searchId = useId();
  const matches = useMemo(() => filterRepos(repos, query), [repos, query]);
  const shown = matches.slice(0, MAX_SHOWN_REPOS);
  const picked = new Set(selected);

  const toggle = (fullName: string, on: boolean) =>
    onChange(on ? [...selected, fullName] : selected.filter((s) => s !== fullName));

  return (
    <div className="rg-repo-picker">
      <label className="rg-field__label" htmlFor={searchId}>
        Search repos
      </label>
      <input
        id={searchId}
        className="rg-input"
        type="search"
        value={query}
        placeholder="Filter by name"
        onChange={(e) => setQuery(e.currentTarget.value)}
      />
      <ul className="rg-repo-picker__list" aria-label="Repos from GitHub">
        {shown.map((r) => (
          <li key={r.fullName}>
            <label className="rg-repo-picker__row">
              <input
                type="checkbox"
                checked={picked.has(r.fullName)}
                disabled={disabled}
                onChange={(e) => toggle(r.fullName, e.currentTarget.checked)}
              />
              <span className="rg-repo-picker__name">{r.fullName}</span>
              <span className="rg-repo-picker__meta">
                {r.private ? "private" : "public"} · {r.defaultBranch} · {pushedAgo(r.pushedAt)}
              </span>
            </label>
          </li>
        ))}
      </ul>
      <div className="rg-field__hint" aria-live="polite">
        {matches.length === 0
          ? "No repo matches that search."
          : matches.length > shown.length
            ? `Showing ${shown.length} of ${matches.length}; search to narrow.`
            : `${selected.length} of ${repos.length} selected.`}
      </div>
    </div>
  );
}
