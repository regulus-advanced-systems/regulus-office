/**
 * "Your GitHub account" in Settings → You, for everyone (#267; SPEC D26, D27).
 * What a person can see in the office comes from their own GitHub access:
 * they link their account once (OAuth on github.com), and the office keeps a
 * snapshot of the repos that account can see. This section shows the linked
 * account, when GitHub was last asked, what the account opens, and lets the
 * person check now or unlink.
 *
 * Only repos the person can see are listed; a closed room is not named or
 * counted here.
 */
import {
  GITHUB_LINK_RESULT_PARAM,
  type GitHubLinkStatus,
  type OperationAccess,
} from "@regulus/protocol";
import { useCallback, useEffect, useState } from "react";
import { useSessionStore } from "../../state/session.ts";
import { FormAlert } from "../auth/AuthCard.tsx";
import { Button } from "../components/Button.tsx";
import {
  createGitHubLinkApi,
  describeGitHubLinkError,
  describeLinkResult,
  type GitHubLinkApi,
} from "./githubLinkApi.ts";
import { openSettingsAt } from "./settingsTabs.ts";

const defaultApi = createGitHubLinkApi();

function linkResultFromUrl(): string | null {
  try {
    return new URLSearchParams(window.location.search).get(GITHUB_LINK_RESULT_PARAM);
  } catch {
    return null;
  }
}

function clearLinkResult(): void {
  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has(GITHUB_LINK_RESULT_PARAM)) return;
    url.searchParams.delete(GITHUB_LINK_RESULT_PARAM);
    window.history.replaceState(window.history.state, "", url);
  } catch {
    // Nothing to clean up.
  }
}

/** Back from github.com (`/office?github_link=…`): open Settings → You to show how it ended. */
export function useGitHubLinkResultOverlay(): void {
  const signedIn = useSessionStore((s) => s.user !== null);
  useEffect(() => {
    if (signedIn && linkResultFromUrl()) openSettingsAt("you");
  }, [signedIn]);
}

const ACCESS_LABELS: Readonly<Record<OperationAccess, string>> = {
  view: "view",
  spawn: "work in the room",
  manage: "manage the room",
};

export function describeLink(status: GitHubLinkStatus): string {
  if (status.state === "linked") return `Linked to ${status.login ?? "your GitHub account"}.`;
  if (status.state === "revoked") {
    return `GitHub no longer accepts the link to ${status.login ?? "your account"} (revoked or expired). Rooms stay closed until you link again.`;
  }
  return "Not linked. Without a linked GitHub account you can only be in the lobby.";
}

export function describeChecked(at: number | null, now: number = Date.now()): string {
  if (at === null) return "Not checked yet.";
  const minutes = Math.max(0, Math.round((now - at) / 60_000));
  if (minutes < 1) return "Last checked just now.";
  if (minutes < 60) return `Last checked ${minutes} min ago.`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `Last checked ${hours} h ago.`;
  return `Last checked ${Math.round(hours / 24)} days ago.`;
}

export function GitHubLinkSection({
  api = defaultApi,
  navigate = (url: string) => window.location.assign(url),
}: {
  api?: GitHubLinkApi;
  navigate?: (url: string) => void;
}) {
  const [status, setStatus] = useState<GitHubLinkStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(() => {
    const result = linkResultFromUrl();
    return result ? describeLinkResult(result) : null;
  });

  const load = useCallback(async () => {
    const res = await api.status();
    if (res.ok) setStatus(res.data);
    else setError(describeGitHubLinkError(res));
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);
  // The result was read into `notice`; a reload should not show it again.
  useEffect(clearLinkResult, []);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  const link = () =>
    run(async () => {
      const res = await api.start();
      if (!res.ok) return setError(describeGitHubLinkError(res));
      navigate(res.data.url);
    });
  const check = () =>
    run(async () => {
      const res = await api.check();
      if (!res.ok) return setError(describeGitHubLinkError(res));
      setStatus(res.data);
    });
  const unlink = () =>
    run(async () => {
      const res = await api.unlink();
      if (!res.ok) return setError(describeGitHubLinkError(res));
      setStatus(res.data);
      setNotice({ ok: true, text: "GitHub account unlinked." });
    });

  const linked = status?.state === "linked";
  return (
    <section className="rg-settings__group" aria-label="Your GitHub account">
      <h3 className="rg-settings__heading">Your GitHub account</h3>
      <div role="status">{status ? describeLink(status) : "Checking…"}</div>
      {status && !status.available && (
        <FormAlert kind="info">
          {status.unavailableReason === "master_key_required"
            ? "Linking is off: the server has no OFFICE_MASTER_KEY, so it cannot store your GitHub token."
            : "Linking is off: this office has no GitHub sign-in set up (GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET)."}
        </FormAlert>
      )}
      {linked && (
        <div className="rg-field__hint">
          {describeChecked(status.lastCheckedAt)}
          {status.organizations.length > 0 && ` Organizations: ${status.organizations.join(", ")}.`}
        </div>
      )}
      {linked && status.lastError && (
        <FormAlert kind="info">{`The last check did not finish: ${status.lastError}`}</FormAlert>
      )}
      {linked &&
        (status.repos.length > 0 ? (
          <ul className="rg-field__hint" aria-label="Repos your account opens">
            {status.repos.map((repo) => (
              <li key={repo.repoId}>
                {repo.fullName}: {repo.permission} on GitHub, so you can{" "}
                {ACCESS_LABELS[repo.access]}
              </li>
            ))}
          </ul>
        ) : (
          <div className="rg-field__hint">
            This account cannot see any of the office's repos, so no room opens for you yet.
          </div>
        ))}
      <div className="rg-settings__row">
        {status?.available && !linked && (
          <Button variant="primary" size="sm" disabled={busy} onClick={() => void link()}>
            {status.state === "revoked" ? "Link again…" : "Link GitHub account…"}
          </Button>
        )}
        {linked && (
          <Button variant="secondary" size="sm" disabled={busy} onClick={() => void check()}>
            Check now
          </Button>
        )}
        {status && status.state !== "not_linked" && (
          <Button variant="destructive" size="sm" disabled={busy} onClick={() => void unlink()}>
            Unlink
          </Button>
        )}
      </div>
      <div className="rg-field__hint">
        The office asks GitHub which of its repos your account can see and opens only those rooms.
        Your token is stored encrypted on the server and is never shown, shared or given to a
        henchman.
      </div>
      {notice && <FormAlert kind={notice.ok ? "info" : "error"}>{notice.text}</FormAlert>}
      {error && <FormAlert>{error}</FormAlert>}
    </section>
  );
}
