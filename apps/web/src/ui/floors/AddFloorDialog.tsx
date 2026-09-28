/**
 * "Add floor" dialog (SPEC §9.1, D7, D14): an owner or admin names the
 * floor, picks a palette (default: next in the cycle) and a size tier, and
 * lists one or more GitHub repos, each with an optional fine-grained PAT
 * scoped to that repo. After creation it shows each repo's clone status.
 *
 * Tokens live only in their (uncontrolled) password inputs until submitted;
 * the inputs are cleared right after and the token is never shown again (the
 * server reports `hasCredential`).
 */
import { PALETTES } from "@regulus/floor-layout";
import type { FloorTemplateTier } from "@regulus/protocol";
import { useId, useState } from "react";
import { useFloorsStore } from "../../state/floors.ts";
import { canManageOffice, useSessionStore } from "../../state/session.ts";
import { useUiStore } from "../../state/ui.ts";
import { FormAlert } from "../auth/AuthCard.tsx";
import { Button } from "../components/Button.tsx";
import { Modal } from "../components/Modal.tsx";
import { createFloorsApi, describeFloorError, type FloorsApi } from "./api.ts";
import { CloneStatusList } from "./CloneStatus.tsx";
import "./floors.css";

export const ADD_FLOOR_OVERLAY = "add-floor";

export const TIER_LABELS: Record<FloorTemplateTier, string> = {
  small: "Small (6 desks)",
  medium: "Medium (12 desks, Office L2)",
  large: "Large (20 desks, two pods)",
};

const defaultApi = createFloorsApi();
let rowSeq = 0;

/** Read the uncontrolled form: name, palette, tier and the non-empty repo rows. */
export function readAddFloorForm(form: HTMLFormElement, rowKeys: readonly number[]) {
  const data = new FormData(form);
  const field = (name: string) => String(data.get(name) ?? "").trim();
  const paletteId = field("palette");
  const repos = rowKeys
    .map((key) => ({ repo: field(`repo-${key}`), token: field(`token-${key}`) }))
    .filter((r) => r.repo)
    .map((r) => (r.token ? r : { repo: r.repo }));
  return {
    name: field("name"),
    tier: (field("tier") || "medium") as FloorTemplateTier,
    ...(paletteId ? { paletteId } : {}),
    repos,
  };
}

export function AddFloorForm({
  api = defaultApi,
  onCreated,
}: {
  api?: FloorsApi;
  onCreated: (floorId: string) => void;
}) {
  const upsert = useFloorsStore((s) => s.upsert);
  const [rows, setRows] = useState<number[]>(() => [++rowSeq]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ids = { name: useId(), palette: useId(), tier: useId() };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const request = readAddFloorForm(form, rows);
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
          The first repo is the floor's primary repo. Public repos need no token; for a private repo
          use a fine-grained token scoped to that repo only. Tokens are stored encrypted and never
          shown again.
        </div>
        <div>
          <Button variant="secondary" size="sm" onClick={() => setRows((r) => [...r, ++rowSeq])}>
            Add another repo
          </Button>
        </div>
      </fieldset>
      {error && <FormAlert>{error}</FormAlert>}
      <Button variant="primary" type="submit" disabled={busy}>
        {busy ? "Creating…" : "Create floor"}
      </Button>
    </form>
  );
}

/** Mounted in the HUD; managers only. Form first, then the new floor's clone status. */
export function AddFloorDialogHost({ api = defaultApi }: { api?: FloorsApi }) {
  const open = useUiStore((s) => s.overlay === ADD_FLOOR_OVERLAY);
  const close = useUiStore((s) => s.closeOverlay);
  const allowed = useSessionStore((s) => canManageOffice(s.user?.role));
  const [created, setCreated] = useState<string | null>(null);
  if (!allowed) return null;
  const done = () => {
    setCreated(null);
    close(ADD_FLOOR_OVERLAY);
  };
  return (
    <Modal
      open={open}
      onClose={done}
      title={created ? "Floor added" : "Add floor"}
      width={560}
      footer={
        created ? (
          <Button variant="secondary" onClick={done}>
            Done
          </Button>
        ) : undefined
      }
    >
      {created ? (
        <CloneStatusList floorId={created} api={api} onRide={done} />
      ) : (
        <AddFloorForm api={api} onCreated={setCreated} />
      )}
    </Modal>
  );
}
