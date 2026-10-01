/**
 * "More options" of the spawn dialog (#142): the first prompt, task title,
 * issue number, permission mode (#166), credential and the own-worktree
 * toggle. All optional; the defaults are "no prompt (the robot waits)", a
 * title from the prompt or the issue, the provider's own permission mode
 * (Claude: auto mode), the default credential and a fresh worktree. Credentials are picked
 * by profile id; no secret is ever asked for or shown here (SPEC §8).
 */

import type { PermissionMode } from "@regulus/protocol";
import { Switch } from "../components/Switch.tsx";
import type { CredentialOption } from "./credentials.ts";
import { permissionModeCopy, permissionModeOptions } from "./permissionModes.ts";
import {
  effectivePermissionModeOf,
  MAX_PROMPT,
  MAX_TITLE,
  type SpawnFormErrors,
  type SpawnFormValues,
} from "./spawnForm.ts";

export interface MoreOptionsProps {
  idBase: string;
  values: SpawnFormValues;
  errors: SpawnFormErrors;
  /** The credential the spawn will use (hand-picked or default). */
  credential: string;
  credentialOptions: readonly CredentialOption[];
  credentialHint: string;
  set: <K extends keyof SpawnFormValues>(key: K, value: SpawnFormValues[K]) => void;
  onSubmitShortcut: (event: React.KeyboardEvent) => void;
}

export function MoreOptions(props: MoreOptionsProps) {
  const { idBase, values, errors, set } = props;
  const f = (name: keyof SpawnFormValues) => `${idBase}-${name}`;
  const invalid = (key: keyof SpawnFormValues) =>
    errors[key] ? { "aria-invalid": true, "aria-describedby": `${f(key)}-error` } : {};
  const error = (key: keyof SpawnFormValues) =>
    errors[key] ? (
      <div id={`${f(key)}-error`} className="rg-field__error">
        {errors[key]}
      </div>
    ) : null;

  return (
    <div className="rg-spawn__more-body">
      <div className="rg-field">
        <label className="rg-field__label" htmlFor={f("prompt")}>
          Prompt <span className="rg-spawn__optional">(optional)</span>
        </label>
        <textarea
          id={f("prompt")}
          className="rg-input rg-spawn__prompt"
          value={values.prompt}
          rows={3}
          maxLength={MAX_PROMPT}
          placeholder="Leave empty and the henchman waits for you at its desk."
          onChange={(e) => set("prompt", e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) props.onSubmitShortcut(e);
          }}
          {...invalid("prompt")}
        />
        {error("prompt")}
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
            placeholder="From the prompt or the issue"
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

      <PermissionModeField
        idBase={idBase}
        values={values}
        error={error("permissionMode")}
        set={set}
      />

      <div className="rg-field">
        <label className="rg-field__label" htmlFor={f("profileId")}>
          Credentials
        </label>
        <select
          id={f("profileId")}
          className="rg-select"
          value={props.credential}
          onChange={(e) => set("profileId", e.target.value)}
        >
          {props.credentialOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <div className="rg-field__hint">{props.credentialHint}</div>
      </div>

      <Switch
        checked={values.autoWorktree}
        onChange={(next) => set("autoWorktree", next)}
        label="Own worktree"
        hint="Work on a fresh branch from the default branch (recommended)."
      />
    </div>
  );
}

/** Permission mode select (#166): the provider's modes, its default marked. */
function PermissionModeField(props: {
  idBase: string;
  values: SpawnFormValues;
  error: React.ReactNode;
  set: MoreOptionsProps["set"];
}) {
  const options = permissionModeOptions(props.values.provider);
  const current = effectivePermissionModeOf(props.values);
  if (options.length === 0 || !current) return null;
  const id = `${props.idBase}-permissionMode`;
  return (
    <div className="rg-field">
      <label className="rg-field__label" htmlFor={id}>
        Permissions
      </label>
      <select
        id={id}
        className="rg-select"
        value={current}
        aria-describedby={`${id}-hint`}
        onChange={(e) => props.set("permissionMode", e.target.value as PermissionMode)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.isDefault ? `${o.label} (default)` : o.label}
          </option>
        ))}
      </select>
      <div id={`${id}-hint`} className="rg-field__hint">
        {permissionModeCopy(current)?.hint}
      </div>
      {props.error}
    </div>
  );
}
