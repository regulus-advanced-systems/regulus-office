/**
 * The lobby's prompt to link GitHub (SPEC D27; #270): shown above the rooms
 * panel while the viewer has no link in force, because until then every room
 * is closed to them. "Link GitHub account…" starts the same OAuth round trip
 * as Settings → You. It disappears once the account is linked.
 */
import { useEffect, useState } from "react";
import { canManageOffice, useSessionStore } from "../../state/session.ts";
import { Button } from "../components/Button.tsx";
import { Panel } from "../Panel.tsx";
import {
  createGitHubLinkApi,
  describeGitHubLinkError,
  type GitHubLinkApi,
} from "../settings/githubLinkApi.ts";
import { linkPromptFor, useLinkStore } from "./linkPrompt.ts";

const defaultApi = createGitHubLinkApi();

/** Keep the viewer's link state current: on sign-in, and when they come back to the tab. */
export function useGitHubLinkState(api: GitHubLinkApi = defaultApi): void {
  const userId = useSessionStore((s) => s.user?.id ?? null);
  useEffect(() => {
    const { refresh, clear } = useLinkStore.getState();
    if (!userId) {
      clear();
      return;
    }
    void refresh(api);
    const onFocus = () => void refresh(api);
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [userId, api]);
}

export function GitHubLinkPrompt({
  api = defaultApi,
  navigate = (url: string) => window.location.assign(url),
}: {
  api?: GitHubLinkApi;
  navigate?: (url: string) => void;
}) {
  useGitHubLinkState(api);
  const status = useLinkStore((s) => s.status);
  const role = useSessionStore((s) => s.user?.role);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const prompt = linkPromptFor(status, canManageOffice(role));
  if (!prompt) return null;
  const link = async () => {
    setBusy(true);
    setError(null);
    const res = await api.start();
    setBusy(false);
    if (!res.ok) return setError(describeGitHubLinkError(res));
    navigate(res.data.url);
  };
  return (
    <Panel as="section" title="Rooms are closed" aria-label="Link your GitHub account">
      <div role="status" data-testid="github-link-prompt" style={{ fontSize: 13 }}>
        {prompt.text}
      </div>
      {prompt.hint && (
        <div className="rg-muted" style={{ fontSize: 12, marginTop: 4 }}>
          {prompt.hint}
        </div>
      )}
      {prompt.canLink && (
        <div style={{ marginTop: 6 }}>
          <Button variant="primary" size="sm" disabled={busy} onClick={() => void link()}>
            Link GitHub account…
          </Button>
        </div>
      )}
      {error && (
        <div role="alert" style={{ fontSize: 12, marginTop: 4 }}>
          {error}
        </div>
      )}
    </Panel>
  );
}
