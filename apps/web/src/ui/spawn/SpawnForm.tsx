/**
 * The spawn form (SPEC §6 `agent.spawn`, §9.2): repo, provider (Claude Code
 * and Codex in M1; the rest disabled until M4), credential profile, model and
 * effort (presets, free text allowed), task title, optional issue number,
 * prompt and the auto-worktree toggle. Credentials are picked by profile id;
 * no secret is ever asked for or shown here (SPEC §8).
 */
import type { CredentialProfileSummary } from "@regulus/protocol";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useProvidersPanel } from "../../state/providersPanel.ts";
import type { SpawnPrefill } from "../../state/spawn.ts";
import { FormAlert } from "../auth/AuthCard.tsx";
import { Button } from "../components/Button.tsx";
import { Switch } from "../components/Switch.tsx";
import { type CredentialProfilesApi, profileOptions } from "./api.ts";
import { PROVIDER_CHOICES, presetsFor, providerLabel } from "./presets.ts";
import {
  initialSpawnValues,
  MAX_PROMPT,
  MAX_TITLE,
  type SpawnFormErrors,
  type SpawnFormValues,
  type SpawnPayload,
  type SpawnRepoOption,
  validateSpawnForm,
  withProvider,
} from "./spawnForm.ts";
import "./spawn.css";

export interface SpawnFormProps {
  floorId: string;
  seatId: string;
  repos: readonly SpawnRepoOption[];
  prefill?: SpawnPrefill;
  api: CredentialProfilesApi;
  /** True while the server works on the spawn. */
  pending: boolean;
  /** The server's rejection, shown above the buttons. */
  serverError: string | null;
  onSubmit: (payload: SpawnPayload) => void;
  onCancel: () => void;
}

function useProfiles(api: CredentialProfilesApi, provider: SpawnFormValues["provider"]) {
  const [state, setState] = useState<{
    provider: string;
    profiles: CredentialProfileSummary[];
    error: string | null;
  }>({ provider: "", profiles: [], error: null });
  useEffect(() => {
    let live = true;
    void api.list(provider).then((result) => {
      if (!live) return;
      setState(
        result.ok
          ? { provider, profiles: result.profiles, error: null }
          : { provider, profiles: [], error: result.code },
      );
    });
    return () => {
      live = false;
    };
  }, [api, provider]);
  return state.provider === provider ? state : { provider, profiles: [], error: null };
}

export function SpawnForm(props: SpawnFormProps) {
  const { repos, prefill, api, pending, serverError } = props;
  const [values, setValues] = useState<SpawnFormValues>(() => initialSpawnValues(repos, prefill));
  const [errors, setErrors] = useState<SpawnFormErrors>({});
  // Disabling the fields drops focus to <body>, where Escape and Tab stop
  // working: keep it on the Close button while pending, then on Spawn.
  const cancelRef = useRef<HTMLButtonElement>(null);
  const submitRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (pending) cancelRef.current?.focus();
    else if (
      document.activeElement === cancelRef.current ||
      document.activeElement === document.body
    )
      submitRef.current?.focus();
  }, [pending]);
  const id = useId();
  const f = (name: keyof SpawnFormValues) => `${id}-${name}`;
  const presets = presetsFor(values.provider);
  const profiles = useProfiles(api, values.provider);
  const openProvidersPanel = useProvidersPanel((s) => s.openProvidersPanel);
  const hasOwnProfile = profiles.profiles.some((p) => p.owner === "me");
  const credentialOptions = useMemo(
    () => profileOptions(values.provider, providerLabel(values.provider), profiles.profiles),
    [values.provider, profiles.profiles],
  );

  const set = <K extends keyof SpawnFormValues>(key: K, value: SpawnFormValues[K]) => {
    setValues((v) => ({ ...v, [key]: value }));
    setErrors((e) => (e[key] ? { ...e, [key]: undefined } : e));
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (pending) return;
    const result = validateSpawnForm(values, {
      floorId: props.floorId,
      seatId: props.seatId,
      repos,
    });
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    props.onSubmit(result.payload);
  };

  const invalid = (key: keyof SpawnFormValues) =>
    errors[key] ? { "aria-invalid": true, "aria-describedby": `${f(key)}-error` } : {};
  const error = (key: keyof SpawnFormValues) =>
    errors[key] ? (
      <div id={`${f(key)}-error`} className="rg-field__error">
        {errors[key]}
      </div>
    ) : null;

  return (
    <form className="rg-spawn" aria-label="Spawn robot" onSubmit={submit} noValidate>
      <fieldset className="rg-spawn__fields" disabled={pending}>
        <div className="rg-spawn__pair">
          <div className="rg-field">
            <label className="rg-field__label" htmlFor={f("repoId")}>
              Repo
            </label>
            <select
              id={f("repoId")}
              className="rg-select"
              value={values.repoId}
              onChange={(e) => set("repoId", e.target.value)}
              {...invalid("repoId")}
            >
              {repos.length === 0 && <option value="">No repos on this floor</option>}
              {repos.map((r) => (
                <option key={r.repoId} value={r.repoId} disabled={!r.ready}>
                  {r.label}
                  {r.ready ? "" : " (not cloned yet)"}
                </option>
              ))}
            </select>
            {error("repoId")}
          </div>
          <div className="rg-field">
            <label className="rg-field__label" htmlFor={f("provider")}>
              Provider
            </label>
            <select
              id={f("provider")}
              className="rg-select"
              value={values.provider}
              onChange={(e) =>
                setValues((v) => withProvider(v, e.target.value as SpawnFormValues["provider"]))
              }
              {...invalid("provider")}
            >
              {PROVIDER_CHOICES.map((p) => (
                <option key={p.id} value={p.id} disabled={Boolean(p.comingIn)}>
                  {p.comingIn ? `${p.label} (${p.comingIn})` : p.label}
                </option>
              ))}
            </select>
            {error("provider")}
          </div>
        </div>

        <div className="rg-field">
          <label className="rg-field__label" htmlFor={f("profileId")}>
            Credentials
          </label>
          <select
            id={f("profileId")}
            className="rg-select"
            value={values.profileId}
            onChange={(e) => set("profileId", e.target.value)}
          >
            {credentialOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <div className="rg-field__hint">
            {profiles.error
              ? "Could not load your saved profiles; your own login still works."
              : "Your login lives in your own runner; keys stay on the server."}
            {!hasOwnProfile && (
              <>
                {" "}
                <button
                  type="button"
                  className="rg-spawn__link"
                  onClick={() => openProvidersPanel(values.provider)}
                >
                  Connect {providerLabel(values.provider)}
                </button>
              </>
            )}
          </div>
        </div>

        <div className="rg-spawn__pair">
          <div className="rg-field">
            <label className="rg-field__label" htmlFor={f("model")}>
              Model
            </label>
            <input
              id={f("model")}
              className="rg-input"
              list={`${f("model")}-presets`}
              value={values.model}
              maxLength={100}
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => set("model", e.target.value)}
              {...invalid("model")}
            />
            <datalist id={`${f("model")}-presets`}>
              {presets.models.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
            {error("model")}
          </div>
          <div className="rg-field">
            <label className="rg-field__label" htmlFor={f("effort")}>
              Effort
            </label>
            {presets.strictEffort ? (
              <select
                id={f("effort")}
                className="rg-select"
                value={values.effort}
                onChange={(e) => set("effort", e.target.value)}
                {...invalid("effort")}
              >
                <option value="">Default</option>
                {presets.efforts.map((e) => (
                  <option key={e} value={e}>
                    {e}
                  </option>
                ))}
              </select>
            ) : (
              <>
                <input
                  id={f("effort")}
                  className="rg-input"
                  list={`${f("effort")}-presets`}
                  value={values.effort}
                  placeholder="Default"
                  maxLength={32}
                  autoComplete="off"
                  onChange={(e) => set("effort", e.target.value)}
                  {...invalid("effort")}
                />
                <datalist id={`${f("effort")}-presets`}>
                  {presets.efforts.map((e) => (
                    <option key={e} value={e} />
                  ))}
                </datalist>
              </>
            )}
            {error("effort")}
          </div>
        </div>

        <div className="rg-spawn__pair rg-spawn__pair--title">
          <div className="rg-field">
            <label className="rg-field__label" htmlFor={f("taskTitle")}>
              Task title
            </label>
            <input
              id={f("taskTitle")}
              className="rg-input"
              value={values.taskTitle}
              maxLength={MAX_TITLE}
              placeholder="Defaults to the prompt's first line"
              onChange={(e) => set("taskTitle", e.target.value)}
              {...invalid("taskTitle")}
            />
            {error("taskTitle")}
          </div>
          <div className="rg-field">
            <label className="rg-field__label" htmlFor={f("issueNumber")}>
              Issue
            </label>
            <input
              id={f("issueNumber")}
              className="rg-input"
              inputMode="numeric"
              value={values.issueNumber}
              placeholder="#"
              onChange={(e) => set("issueNumber", e.target.value)}
              {...invalid("issueNumber")}
            />
            {error("issueNumber")}
          </div>
        </div>

        <div className="rg-field">
          <label className="rg-field__label" htmlFor={f("prompt")}>
            Prompt
          </label>
          <textarea
            id={f("prompt")}
            className="rg-input rg-spawn__prompt"
            value={values.prompt}
            rows={4}
            maxLength={MAX_PROMPT}
            placeholder="What should the robot do?"
            onChange={(e) => set("prompt", e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) submit(e);
            }}
            {...invalid("prompt")}
          />
          {error("prompt")}
        </div>

        <Switch
          checked={values.autoWorktree}
          onChange={(next) => set("autoWorktree", next)}
          label="Own worktree"
          hint="Work on a fresh branch from the default branch (recommended)."
        />
      </fieldset>

      {serverError && <FormAlert>{serverError}</FormAlert>}
      <div className="rg-spawn__actions">
        <Button ref={cancelRef} variant="secondary" onClick={props.onCancel}>
          {pending ? "Close" : "Cancel"}
        </Button>
        <Button
          ref={submitRef}
          variant="primary"
          type="submit"
          disabled={pending}
          aria-busy={pending}
        >
          {pending ? "Spawning…" : "Spawn robot"}
        </Button>
      </div>
    </form>
  );
}
