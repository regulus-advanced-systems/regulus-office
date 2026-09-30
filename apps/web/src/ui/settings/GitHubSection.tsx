/**
 * "GitHub" in Settings, for owners and admins (#141; SPEC §8, D14): connect
 * the office to GitHub once, so "Add floor" can list the org's repos and
 * clones and PRs use the connection's token.
 *
 * - GitHub App (recommended): the manifest flow. The office returns a
 *   manifest and a one-time state; the page posts them to github.com, where
 *   the owner creates the app and then installs it on the org.
 * - Org fine-grained PAT (fallback): pasted once, stored encrypted, never
 *   shown again. The input is cleared right after the request.
 */
import {
  GITHUB_RESULT_PARAM,
  type GitHubConnectionStatus,
  type StartManifestResponse,
} from "@regulus/protocol";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { canManageOffice, useSessionStore } from "../../state/session.ts";
import { useUiStore } from "../../state/ui.ts";
import { FormAlert } from "../auth/AuthCard.tsx";
import { Button } from "../components/Button.tsx";
import {
  createGitHubApi,
  describeGitHubError,
  describeManifestResult,
  type GitHubApi,
} from "./githubApi.ts";

const defaultApi = createGitHubApi();

/** Post the manifest to github.com as a form (a top-level navigation, as GitHub requires). */
export function postManifestForm({ action, manifest }: StartManifestResponse): void {
  const form = document.createElement("form");
  form.method = "post";
  form.action = action;
  form.style.display = "none";
  const input = document.createElement("input");
  input.type = "hidden";
  input.name = "manifest";
  input.value = manifest;
  form.append(input);
  document.body.append(form);
  form.submit();
}

function manifestResultFromUrl(): string | null {
  try {
    return new URLSearchParams(window.location.search).get(GITHUB_RESULT_PARAM);
  } catch {
    return null;
  }
}

function clearManifestResult(): void {
  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has(GITHUB_RESULT_PARAM)) return;
    url.searchParams.delete(GITHUB_RESULT_PARAM);
    window.history.replaceState(window.history.state, "", url);
  } catch {
    // Nothing to clean up.
  }
}

/**
 * Back from github.com (`/office?github=…`): open Settings so the owner sees
 * how the manifest flow ended. Mounted with the HUD's dialogs.
 */
export function useGitHubResultOverlay(): void {
  const allowed = useSessionStore((s) => canManageOffice(s.user?.role));
  const openOverlay = useUiStore((s) => s.openOverlay);
  useEffect(() => {
    if (allowed && manifestResultFromUrl()) openOverlay("settings");
  }, [allowed, openOverlay]);
}

export function describeConnection(status: GitHubConnectionStatus): string {
  if (status.kind === "pat") {
    return `Connected with an organization token${status.pat?.login ? ` (${status.pat.login})` : ""}.`;
  }
  if (status.kind === "app" && status.app) {
    const name = status.app.name ?? status.app.slug ?? `app ${status.app.appId}`;
    const where = status.app.installations
      .map(
        (i) => `${i.account} (${i.repositorySelection === "all" ? "all repos" : "selected repos"})`,
      )
      .join(", ");
    return `Connected with the GitHub App ${name}${where ? `, installed on ${where}` : ""}.`;
  }
  return "Not connected. Add floor takes typed repo names only.";
}

export function GitHubSection({
  api = defaultApi,
  submitManifest = postManifestForm,
}: {
  api?: GitHubApi;
  submitManifest?: (start: StartManifestResponse) => void;
}) {
  const role = useSessionStore((s) => s.user?.role);
  const [status, setStatus] = useState<GitHubConnectionStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(() => {
    const result = manifestResultFromUrl();
    return result ? describeManifestResult(result) : null;
  });
  const orgRef = useRef<HTMLInputElement>(null);
  const tokenRef = useRef<HTMLInputElement>(null);
  const ids = { org: useId(), token: useId() };
  const allowed = canManageOffice(role);

  const load = useCallback(async () => {
    const res = await api.status();
    if (res.ok) setStatus(res.data);
    else setError(describeGitHubError(res));
  }, [api]);

  useEffect(() => {
    if (allowed) void load();
  }, [allowed, load]);
  // The result was read into `notice`; a reload should not show it again.
  useEffect(clearManifestResult, []);

  if (!allowed) return null;

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

  const createApp = () =>
    run(async () => {
      const org = orgRef.current?.value.trim() || undefined;
      const res = await api.startManifest(org);
      if (!res.ok) return setError(describeGitHubError(res));
      submitManifest(res.data);
    });

  const connectToken = () =>
    run(async () => {
      const input = tokenRef.current;
      const token = input?.value.trim() ?? "";
      if (input) input.value = "";
      if (!token) return setError("Paste the organization's fine-grained token first.");
      const res = await api.connectPat(token);
      if (!res.ok) return setError(describeGitHubError(res));
      setStatus(res.data);
      setNotice({ ok: true, text: "Connected. Add floor now lists the token's repos." });
    });

  const disconnect = () =>
    run(async () => {
      const res = await api.disconnect();
      if (!res.ok) return setError(describeGitHubError(res));
      setNotice({ ok: true, text: "Disconnected from GitHub." });
      await load();
    });

  const app = status?.kind === "app" ? status.app : null;
  const notInstalled = app !== null && app.installations.length === 0 && !app.error;

  return (
    <section className="rg-field" aria-label="GitHub">
      <div className="rg-field__label">GitHub</div>
      <div role="status">{status ? describeConnection(status) : "Checking…"}</div>
      {app?.error && (
        <FormAlert>{`GitHub could not list the app's installations: ${app.error}`}</FormAlert>
      )}
      {notInstalled && (
        <div className="rg-field__hint">
          The app is not installed yet.{" "}
          {app.installUrl && (
            <a href={app.installUrl} target="_blank" rel="noreferrer">
              Install it on your organization
            </a>
          )}
        </div>
      )}
      {status?.source === "env" && (
        <div className="rg-field__hint">
          Set by the server environment (GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY).
        </div>
      )}
      {status && status.kind !== "none" && status.source === "db" && (
        <div>
          <Button variant="destructive" size="sm" disabled={busy} onClick={() => void disconnect()}>
            Disconnect GitHub
          </Button>
        </div>
      )}
      {status?.kind === "none" && !status.canStore && (
        <FormAlert kind="info">
          The server has no OFFICE_MASTER_KEY, so it cannot store GitHub credentials.
        </FormAlert>
      )}
      {status?.kind === "none" && status.canStore && (
        <>
          <label className="rg-field__label" htmlFor={ids.org}>
            Organization (leave empty for your personal account)
          </label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input
              id={ids.org}
              ref={orgRef}
              className="rg-input"
              placeholder="your-org"
              autoComplete="off"
              style={{ flex: "1 1 160px" }}
            />
            <Button variant="primary" size="sm" disabled={busy} onClick={() => void createApp()}>
              Create GitHub App…
            </Button>
          </div>
          <div className="rg-field__hint">
            Recommended. GitHub opens to confirm a private app for this office, then asks you to
            install it on the organization for all or selected repos. It asks for contents, pull
            requests, issues and checks (read and write), and metadata (read).
          </div>
          <label className="rg-field__label" htmlFor={ids.token}>
            Or an organization access token
          </label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input
              id={ids.token}
              ref={tokenRef}
              className="rg-input"
              type="password"
              autoComplete="off"
              placeholder="github_pat_…"
              style={{ flex: "1 1 160px" }}
            />
            <Button
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={() => void connectToken()}
            >
              Connect with token
            </Button>
          </div>
          <div className="rg-field__hint">
            A fine-grained token whose resource owner is the organization, for all or selected
            repos, with Contents and Pull requests (read and write) and Metadata (read). Stored
            encrypted and never shown again.
          </div>
        </>
      )}
      {notice && <FormAlert kind={notice.ok ? "info" : "error"}>{notice.text}</FormAlert>}
      {error && <FormAlert>{error}</FormAlert>}
    </section>
  );
}
