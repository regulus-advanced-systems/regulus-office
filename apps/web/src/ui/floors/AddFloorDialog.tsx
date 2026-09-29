/**
 * "Add floor" dialog (SPEC §9.1, D7, D14): an owner or admin names the
 * floor, picks a palette (default: next in the cycle) and a size tier, and
 * chooses one or more GitHub repos. With the office GitHub connection (#141)
 * they are picked from a searchable list of every repo it can see; "Other
 * repo…" (or, without a connection, the only option) takes a typed
 * owner/name with an optional fine-grained PAT scoped to that repo. After
 * creation it shows each repo's clone status.
 *
 * Tokens live only in their (uncontrolled) password inputs until submitted;
 * the inputs are cleared right after and the token is never shown again (the
 * server reports `hasCredential`).
 */
import { PALETTES } from "@regulus/floor-layout";
import type { FloorTemplateTier, GitHubRepoInfo } from "@regulus/protocol";
import { useEffect, useId, useState } from "react";
import { useFloorsStore } from "../../state/floors.ts";
import { canManageOffice, useSessionStore } from "../../state/session.ts";
import { useUiStore } from "../../state/ui.ts";
import { FormAlert } from "../auth/AuthCard.tsx";
import { Button } from "../components/Button.tsx";
import { Modal } from "../components/Modal.tsx";
import { useGitHubResultOverlay } from "../settings/GitHubSection.tsx";
import { createGitHubApi, describeGitHubError, type GitHubApi } from "../settings/githubApi.ts";
import { createFloorsApi, describeFloorError, type FloorsApi } from "./api.ts";
import { CloneStatusList } from "./CloneStatus.tsx";
import { floorSettingsOverlay } from "./floorSettings.ts";
import { RepoPicker } from "./RepoPicker.tsx";
import "./floors.css";

export const ADD_FLOOR_OVERLAY = "add-floor";

export const TIER_LABELS: Record<FloorTemplateTier, string> = {
  small: "Small (6 desks)",
  medium: "Medium (12 desks, Office L2)",
  large: "Large (20 desks, two pods)",
};

const defaultApi = createFloorsApi();
const defaultGitHubApi = createGitHubApi();
let rowSeq = 0;

/**
 * Read the uncontrolled form: name, palette, tier, then the repos: those
 * picked from the connection's list first (in the order picked, no token:
 * the connection covers them), then the non-empty typed rows.
 */
export function readAddFloorForm(
  form: HTMLFormElement,
  rowKeys: readonly number[],
  picked: readonly string[] = [],
) {
  const data = new FormData(form);
  const field = (name: string) => String(data.get(name) ?? "").trim();
  const paletteId = field("palette");
  const typed = rowKeys
    .map((key) => ({ repo: field(`repo-${key}`), token: field(`token-${key}`) }))
    .filter((r) => r.repo)
    .map((r) => (r.token ? r : { repo: r.repo }));
  const repos = [...picked.map((repo) => ({ repo })), ...typed];
  return {
    name: field("name"),
    tier: (field("tier") || "medium") as FloorTemplateTier,
    ...(paletteId ? { paletteId } : {}),
    repos,
  };
}

/** The connection's repos: not connected, loading, loaded, or failed (typed repos still work). */
type ConnectionRepos =
  | { state: "none" }
  | { state: "loading" }
  | { state: "ready"; repos: GitHubRepoInfo[]; truncated: boolean }
  | { state: "error"; message: string };

function useConnectionRepos(github: GitHubApi): ConnectionRepos {
  const [value, setValue] = useState<ConnectionRepos>({ state: "loading" });
  useEffect(() => {
    let live = true;
    void (async () => {
      const status = await github.status();
      if (!live) return;
      if (!status.ok || status.data.kind === "none") return setValue({ state: "none" });
      const listed = await github.repos();
      if (!live) return;
      setValue(
        listed.ok
          ? { state: "ready", repos: listed.data.repos, truncated: listed.data.truncated }
          : { state: "error", message: describeGitHubError(listed) },
      );
    })();
    return () => {
      live = false;
    };
  }, [github]);
  return value;
}

export function AddFloorForm({
  api = defaultApi,
  github = defaultGitHubApi,
  onCreated,
}: {
  api?: FloorsApi;
  github?: GitHubApi;
  onCreated: (floorId: string) => void;
}) {
  const upsert = useFloorsStore((s) => s.upsert);
  const [rows, setRows] = useState<number[]>(() => [++rowSeq]);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ids = { name: useId(), palette: useId(), tier: useId() };
  const connection = useConnectionRepos(github);
  const listed = connection.state === "ready";

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const request = readAddFloorForm(form, rows, listed ? picked : []);
    if (!request.name || request.repos.length === 0) {
      setError("Give the floor a name and at least one repo.");
      return;
    }
    setBusy(true);
    setError(null);
    const result = await api.create(request);
    // Tokens do not outlive the request in the page.
    for (const input of form.querySelectorAll<HTMLInputElement>('input[type="password"]')) {
      input.value = "";
    }
    setBusy(false);
    if (!result.ok) {
      setError(describeFloorError(result));
      return;
    }
    upsert(result.data);
    onCreated(result.data.floorId);
  };

  const typedRows = (
    <>
      {rows.map((key, i) => (
        <div key={key} className="rg-floor-form__repo">
          <input
            name={`repo-${key}`}
            className="rg-input"
            aria-label={`Repo ${i + 1}`}
            placeholder="owner/name or https://github.com/owner/name"
          />
          <input
            name={`token-${key}`}
            className="rg-input"
            type="password"
            autoComplete="off"
            aria-label={`Access token for repo ${i + 1}`}
            placeholder="Fine-grained token (private repos)"
          />
          {rows.length > 1 && (
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Remove repo ${i + 1}`}
              onClick={() => setRows((r) => r.filter((k) => k !== key))}
            >
              Remove
            </Button>
          )}
        </div>
      ))}
      <div className="rg-field__hint">
        The first repo is the floor's primary repo. Public repos, and repos the office GitHub
        connection covers, need no token; for another private repo use a fine-grained token scoped
        to that repo only. Tokens are stored encrypted and never shown again.
      </div>
      <div>
        <Button variant="secondary" size="sm" onClick={() => setRows((r) => [...r, ++rowSeq])}>
          Add another repo
        </Button>
      </div>
    </>
  );

  return (
    <form onSubmit={(e) => void submit(e)} aria-label="Add floor">
      <div className="rg-field">
        <label className="rg-field__label" htmlFor={ids.name}>
          Floor name
        </label>
        <input id={ids.name} name="name" className="rg-input" maxLength={80} />
      </div>
      <div className="rg-floor-form__pair">
        <div className="rg-field">
          <label className="rg-field__label" htmlFor={ids.palette}>
            Palette
          </label>
          <select id={ids.palette} name="palette" className="rg-select" defaultValue="">
            <option value="">Next in the cycle</option>
            {PALETTES.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div className="rg-field">
          <label className="rg-field__label" htmlFor={ids.tier}>
            Size
          </label>
          <select id={ids.tier} name="tier" className="rg-select" defaultValue="medium">
            {(Object.keys(TIER_LABELS) as FloorTemplateTier[]).map((t) => (
              <option key={t} value={t}>
                {TIER_LABELS[t]}
              </option>
            ))}
          </select>
        </div>
      </div>
      <fieldset className="rg-field rg-floor-form__repos">
        <legend className="rg-field__label">Repos</legend>
        {connection.state === "loading" && (
          <div className="rg-field__hint">Loading repos from GitHub…</div>
        )}
        {connection.state === "error" && <FormAlert>{connection.message}</FormAlert>}
        {listed && (
          <>
            <RepoPicker
              repos={connection.repos}
              selected={picked}
              onChange={setPicked}
              disabled={busy}
            />
            {connection.truncated && (
              <div className="rg-field__hint">
                GitHub listed more repos than the office shows; use Other repo… for the rest.
              </div>
            )}
          </>
        )}
        {listed ? (
          <details className="rg-floor-form__other">
            <summary>Other repo…</summary>
            {typedRows}
          </details>
        ) : (
          typedRows
        )}
        {connection.state === "none" && (
          <div className="rg-field__hint">
            Connect GitHub in Settings to pick repos from a list instead of typing them.
          </div>
        )}
      </fieldset>
      {error && <FormAlert>{error}</FormAlert>}
      <Button variant="primary" type="submit" disabled={busy}>
        {busy ? "Creating…" : "Create floor"}
      </Button>
    </form>
  );
}

/**
 * Mounted in the HUD; managers only. Form first, then the new floor's clone
 * status with "Add people…", which hands over to the floor settings panel.
 */
export function AddFloorDialogHost({
  api = defaultApi,
  github = defaultGitHubApi,
}: {
  api?: FloorsApi;
  github?: GitHubApi;
}) {
  const open = useUiStore((s) => s.overlay === ADD_FLOOR_OVERLAY);
  const close = useUiStore((s) => s.closeOverlay);
  const openOverlay = useUiStore((s) => s.openOverlay);
  const allowed = useSessionStore((s) => canManageOffice(s.user?.role));
  const [created, setCreated] = useState<string | null>(null);
  // Back from the GitHub App manifest flow: show the result in Settings.
  useGitHubResultOverlay();
  if (!allowed) return null;
  const done = () => {
    setCreated(null);
    close(ADD_FLOOR_OVERLAY);
  };
  // A new floor has no one on it yet: offer to add people straight away.
  const addPeople = (floorId: string) => {
    setCreated(null);
    openOverlay(floorSettingsOverlay(floorId));
  };
  return (
    <Modal
      open={open}
      onClose={done}
      title={created ? "Floor added" : "Add floor"}
      width={560}
      footer={
        created ? (
          <>
            <Button variant="secondary" aria-haspopup="dialog" onClick={() => addPeople(created)}>
              Add people…
            </Button>
            <Button variant="secondary" onClick={done}>
              Done
            </Button>
          </>
        ) : undefined
      }
    >
      {created ? (
        <CloneStatusList floorId={created} api={api} onRide={done} />
      ) : (
        <AddFloorForm api={api} github={github} onCreated={setCreated} />
      )}
    </Modal>
  );
}
