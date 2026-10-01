/**
 * "Use an existing GitHub App…" in Settings → GitHub (#224; SPEC §8, D14):
 * connect an app the owner already has instead of creating a second one.
 *
 * Shows what the app needs for this office (webhook URL, setup URL,
 * permissions and events, all from the server's manifest), then sends the app
 * ID, private key (a picked `.pem` file or pasted), and optionally a new
 * webhook secret and the client ID once. The server checks them with GitHub
 * before storing them encrypted. The inputs are uncontrolled and cleared right
 * after the request, so the key and secret never sit in React state.
 */
import type {
  ConnectExistingAppRequest,
  ConnectExistingAppResponse,
  GitHubAppRequirements,
} from "@regulus/protocol";
import { useId, useRef, useState } from "react";
import { FormAlert } from "../auth/AuthCard.tsx";
import type { ApiFailure } from "../auth/api.ts";
import { Button } from "../components/Button.tsx";
import { describeGitHubError, type GitHubApi } from "./githubApi.ts";

/** `pull_requests` → `Pull requests`. */
export function permissionLabel(name: string): string {
  const words = name.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** What the connected app still lacks, as one sentence; null when nothing. */
export function describeMissing(res: ConnectExistingAppResponse): string | null {
  const parts: string[] = [];
  if (res.missingPermissions.length > 0) {
    const list = res.missingPermissions
      .map((p) => `${permissionLabel(p.name)} (${p.required}; has ${p.granted ?? "none"})`)
      .join(", ");
    parts.push(`permissions: ${list}`);
  }
  if (res.missingEvents.length > 0) parts.push(`events: ${res.missingEvents.join(", ")}`);
  if (parts.length === 0) return null;
  return `The app still lacks ${parts.join("; ")}. Change it in the app's settings on GitHub, then accept the new permissions on the organization's installation.`;
}

function describeConnectError(err: ApiFailure): string {
  switch (err.code) {
    case "invalid_private_key":
    case "app_id_mismatch":
    case "github_rejected":
      return err.reason ?? "GitHub did not accept that app ID and key.";
    case "invalid_body":
      return "Check the fields: a numeric app ID and the app's .pem private key are required.";
    default:
      return describeGitHubError(err);
  }
}

function Requirements({ req }: { req: GitHubAppRequirements }) {
  return (
    <div className="rg-field__hint">
      <div>Set on the app (Settings → Developer settings → GitHub Apps → Edit):</div>
      <ul>
        <li>
          Webhook URL:{" "}
          {req.webhookUrl ? (
            <code>{req.webhookUrl}</code>
          ) : (
            "none (this office has no public https URL, so boards poll instead)"
          )}
        </li>
        <li>
          Setup URL (optional): <code>{req.setupUrl}</code>
        </li>
        <li>
          Repository permissions:{" "}
          {Object.entries(req.permissions)
            .map(([name, level]) => `${permissionLabel(name)} (${level})`)
            .join(", ")}
        </li>
        {req.webhookUrl && <li>Subscribe to events: {req.events.join(", ")}</li>}
      </ul>
    </div>
  );
}

export function ExistingAppForm({
  api,
  onConnected,
}: {
  api: GitHubApi;
  onConnected: (res: ConnectExistingAppResponse) => void;
}) {
  const [open, setOpen] = useState(false);
  const [req, setReq] = useState<GitHubAppRequirements | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refs = {
    appId: useRef<HTMLInputElement>(null),
    file: useRef<HTMLInputElement>(null),
    key: useRef<HTMLTextAreaElement>(null),
    secret: useRef<HTMLInputElement>(null),
    clientId: useRef<HTMLInputElement>(null),
  };
  const ids = { appId: useId(), file: useId(), key: useId(), secret: useId(), clientId: useId() };

  const show = async () => {
    setOpen(true);
    if (req) return;
    const res = await api.appRequirements();
    if (res.ok) setReq(res.data);
    else setError(describeGitHubError(res));
  };

  const pickFile = async () => {
    const file = refs.file.current?.files?.[0];
    if (!file) return;
    const text = await file.text();
    if (refs.key.current) refs.key.current.value = text;
    if (refs.file.current) refs.file.current.value = "";
  };

  const clear = () => {
    for (const ref of Object.values(refs)) if (ref.current) ref.current.value = "";
  };

  const submit = async () => {
    const appId = Number(refs.appId.current?.value.trim() ?? "");
    const privateKey = refs.key.current?.value.trim() ?? "";
    const webhookSecret = refs.secret.current?.value.trim() ?? "";
    const clientId = refs.clientId.current?.value.trim() ?? "";
    clear();
    setError(null);
    if (!Number.isInteger(appId) || appId <= 0) return setError("Enter the app's numeric App ID.");
    if (!privateKey) return setError("Pick the app's .pem private key or paste it.");
    const body: ConnectExistingAppRequest = { appId, privateKey };
    if (webhookSecret) body.webhookSecret = webhookSecret;
    if (clientId) body.clientId = clientId;
    setBusy(true);
    try {
      const res = await api.connectExistingApp(body);
      if (!res.ok) return setError(describeConnectError(res));
      onConnected(res.data);
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <div>
        <Button variant="secondary" size="sm" onClick={() => void show()}>
          Use an existing GitHub App…
        </Button>
        {error && <FormAlert>{error}</FormAlert>}
      </div>
    );
  }

  return (
    <fieldset className="rg-field" aria-label="Existing GitHub App" disabled={busy}>
      <div className="rg-field__label">Use an existing GitHub App</div>
      {req ? <Requirements req={req} /> : <div className="rg-field__hint">Loading…</div>}
      <label className="rg-field__label" htmlFor={ids.appId}>
        App ID
      </label>
      <input
        id={ids.appId}
        ref={refs.appId}
        className="rg-input"
        inputMode="numeric"
        autoComplete="off"
        placeholder="123456"
      />
      <label className="rg-field__label" htmlFor={ids.file}>
        Private key (.pem file)
      </label>
      <input
        id={ids.file}
        ref={refs.file}
        type="file"
        accept=".pem,application/x-pem-file"
        onChange={() => void pickFile()}
      />
      <label className="rg-field__label" htmlFor={ids.key}>
        Or paste the private key
      </label>
      <textarea
        id={ids.key}
        ref={refs.key}
        className="rg-input"
        rows={4}
        autoComplete="off"
        spellCheck={false}
        placeholder="-----BEGIN RSA PRIVATE KEY-----"
      />
      <label className="rg-field__label" htmlFor={ids.secret}>
        Webhook secret (optional)
      </label>
      <input
        id={ids.secret}
        ref={refs.secret}
        className="rg-input"
        type="password"
        autoComplete="off"
      />
      <div className="rg-field__hint">
        GitHub never shows the old secret again: set a new one in the app's settings and paste it
        here. Left empty, an office with a public https URL sets one on the app itself.
      </div>
      <label className="rg-field__label" htmlFor={ids.clientId}>
        Client ID (optional)
      </label>
      <input
        id={ids.clientId}
        ref={refs.clientId}
        className="rg-input"
        autoComplete="off"
        placeholder="Iv1…"
      />
      <div className="rg-field__hint">
        The office checks the ID and key with GitHub, then stores them encrypted. They are never
        shown again.
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Button variant="primary" size="sm" disabled={busy} onClick={() => void submit()}>
          Connect app
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={busy}
          onClick={() => {
            clear();
            setError(null);
            setOpen(false);
          }}
        >
          Cancel
        </Button>
      </div>
      {error && <FormAlert>{error}</FormAlert>}
    </fieldset>
  );
}
