/**
 * API keys and plan keys (SPEC §8 rules 2 and 3, D2): pick a preset, paste
 * the key once. The server verifies it with the provider, stores it
 * encrypted and never returns it; the key input is cleared right after the
 * request. Owners/admins may add office-wide keys for metered providers.
 */
import {
  isOfficeKeyPreset,
  KEY_PRESET_IDS,
  KEY_PRESETS,
  type KeyPresetId,
  type KeyProfileInfo,
  type KeyVerifyOutcome,
} from "@regulus/protocol";
import { useCallback, useEffect, useId, useState } from "react";
import { canManageOffice, useSessionStore } from "../../state/session.ts";
import { FormAlert } from "../auth/AuthCard.tsx";
import { Button } from "../components/Button.tsx";
import { describeProvidersError, type ProvidersApi } from "./api.ts";

const OUTCOME_TEXT: Record<KeyVerifyOutcome, string> = {
  ok: "Key verified with the provider.",
  rejected: "The provider rejected the key.",
  unreachable: "Saved, but the provider could not be reached to verify it.",
  unsupported: "Saved. Custom endpoints are not verified.",
};

function verifiedText(p: KeyProfileInfo): string {
  if (p.verifiedAt === null) return "not verified";
  return `verified ${new Date(p.verifiedAt).toLocaleDateString()}`;
}

/** Clear every key field of a form (keys never outlive the request in the page). */
function clearKeys(form: HTMLFormElement): void {
  for (const input of form.querySelectorAll<HTMLInputElement>('input[type="password"]')) {
    input.value = "";
  }
}

export function KeyProfiles({ api, focus }: { api: ProvidersApi; focus?: string | null }) {
  const role = useSessionStore((s) => s.user?.role);
  const manager = canManageOffice(role);
  const [profiles, setProfiles] = useState<KeyProfileInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [preset, setPreset] = useState<KeyPresetId>(() => {
    const match = KEY_PRESET_IDS.find((id) => KEY_PRESETS[id].provider === focus);
    return match ?? "anthropic";
  });
  const [verifying, setVerifying] = useState<string | null>(null);
  const ids = { preset: useId(), label: useId(), key: useId(), url: useId() };

  const load = useCallback(async () => {
    const res = await api.profiles();
    if (res.ok) setProfiles(res.data.profiles);
    else setError(describeProvidersError(res));
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const current = KEY_PRESETS[preset];
  const custom = !current.baseUrl && current.authKind === "base_url_key";

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const field = (name: string) => String(data.get(name) ?? "").trim();
    const apiKey = field("apiKey");
    clearKeys(form);
    if (!apiKey) {
      setError("Paste the key.");
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    const res = await api.createProfile({
      preset,
      label: field("label") || current.label,
      apiKey,
      ...(custom ? { baseUrl: field("baseUrl") } : {}),
      owner: data.get("office") === "on" ? "office" : "me",
    });
    setBusy(false);
    if (!res.ok) {
      setError(describeProvidersError(res));
      return;
    }
    setNotice(OUTCOME_TEXT[res.data.verification]);
    form.reset();
    await load();
  };

  const reverify = async (event: React.FormEvent<HTMLFormElement>, profile: KeyProfileInfo) => {
    event.preventDefault();
    const form = event.currentTarget;
    const apiKey = String(new FormData(form).get("apiKey") ?? "").trim();
    clearKeys(form);
    if (!apiKey) return;
    setError(null);
    const res = await api.verifyProfile(profile.id, apiKey);
    if (!res.ok) {
      setError(describeProvidersError(res));
      return;
    }
    setNotice(OUTCOME_TEXT[res.data.verification]);
    setVerifying(null);
    await load();
  };

  const remove = async (profile: KeyProfileInfo) => {
    setError(null);
    const res = await api.deleteProfile(profile.id);
    if (!res.ok) setError(describeProvidersError(res));
    await load();
  };

  const mayEdit = (p: KeyProfileInfo) => p.owner === "me" || manager;

  return (
    <section className="rg-providers__section" aria-label="API and plan keys">
      <h3 className="rg-providers__heading">API and plan keys</h3>
      {profiles && profiles.length === 0 && <p className="rg-muted">No keys yet.</p>}
      <ul className="rg-providers__list">
        {profiles?.map((p) => (
          <li key={p.id} className="rg-providers__profile" data-owner={p.owner}>
            <div className="rg-providers__row-head">
              <div>
                <strong>{p.label}</strong>{" "}
                <span className="rg-muted">
                  {p.preset ? KEY_PRESETS[p.preset].label : p.provider}
                  {p.baseUrlHost && p.preset?.startsWith("custom") ? ` (${p.baseUrlHost})` : ""}
                  {" · "}
                  {verifiedText(p)}
                </span>
              </div>
              {p.owner === "office" && <span className="rg-providers__badge">Office</span>}
              {mayEdit(p) && (
                <>
                  <Button size="sm" variant="ghost" onClick={() => setVerifying(p.id)}>
                    Replace key
                  </Button>
                  <Button size="sm" variant="destructive" onClick={() => void remove(p)}>
                    Delete
                  </Button>
                </>
              )}
            </div>
            {verifying === p.id && (
              <form
                className="rg-providers__inline"
                aria-label={`Replace key for ${p.label}`}
                onSubmit={(e) => void reverify(e, p)}
              >
                <input
                  name="apiKey"
                  type="password"
                  autoComplete="off"
                  className="rg-input"
                  aria-label="New key"
                  placeholder="Paste the key again to verify it"
                />
                <Button size="sm" type="submit" variant="primary">
                  Verify and save
                </Button>
              </form>
            )}
          </li>
        ))}
      </ul>

      <form className="rg-providers__add" aria-label="Add key" onSubmit={(e) => void submit(e)}>
        <div className="rg-field">
          <label className="rg-field__label" htmlFor={ids.preset}>
            Provider
          </label>
          <select
            id={ids.preset}
            className="rg-select"
            value={preset}
            onChange={(e) => setPreset(e.currentTarget.value as KeyPresetId)}
          >
            {KEY_PRESET_IDS.map((id) => (
              <option key={id} value={id}>
                {KEY_PRESETS[id].label}
              </option>
            ))}
          </select>
          <div className="rg-field__hint">{current.hint}</div>
        </div>
        <div className="rg-field">
          <label className="rg-field__label" htmlFor={ids.label}>
            Label
          </label>
          <input
            id={ids.label}
            name="label"
            className="rg-input"
            maxLength={80}
            placeholder={current.label}
          />
        </div>
        {custom && (
          <div className="rg-field">
            <label className="rg-field__label" htmlFor={ids.url}>
              Base URL
            </label>
            <input
              id={ids.url}
              name="baseUrl"
              className="rg-input"
              placeholder="https://gateway.example/anthropic"
            />
          </div>
        )}
        <div className="rg-field">
          <label className="rg-field__label" htmlFor={ids.key}>
            Key
          </label>
          <input
            id={ids.key}
            name="apiKey"
            type="password"
            autoComplete="off"
            className="rg-input"
          />
          <div className="rg-field__hint">
            Stored encrypted and only given to your own agents when they start. It is never shown
            again.
          </div>
        </div>
        {manager && isOfficeKeyPreset(preset) && (
          <label className="rg-providers__check">
            <input type="checkbox" name="office" /> Office-wide key (members may choose it per
            henchman; usage counts as "office")
          </label>
        )}
        {error && <FormAlert>{error}</FormAlert>}
        {notice && (
          <p className="rg-providers__done" role="status">
            {notice}
          </p>
        )}
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? "Verifying…" : "Add key"}
        </Button>
      </form>
    </section>
  );
}
