/**
 * The spawn dialog's smaller radio groups (#142): the effort levels of the
 * chosen model as a segmented control, and the floor's repos as a list
 * (only shown when the floor has more than one).
 */
import type { ProviderId } from "@regulus/protocol";
import { effortLabel, findModel } from "./models.ts";
import type { SpawnRepoOption } from "./spawnForm.ts";

export function EffortPicker(props: {
  idBase: string;
  provider: ProviderId;
  model: string;
  effort: string;
  onChange: (effort: string) => void;
  error?: string;
}) {
  const preset = findModel(props.provider, props.model);
  const efforts = preset?.efforts ?? [];
  return (
    <fieldset className="rg-spawn__group">
      <legend className="rg-field__label">Effort</legend>
      {efforts.length === 0 ? (
        <p className="rg-field__hint rg-spawn__none">
          {preset ? `${preset.label} has no effort setting.` : "Pick a model first."}
        </p>
      ) : (
        <div className="rg-spawn__segments">
          {efforts.map((e) => {
            const id = `${props.idBase}-${e}`;
            const isDefault = e === preset?.defaultEffort;
            return (
              <label
                key={e}
                htmlFor={id}
                className="rg-spawn__segment"
                data-checked={props.effort === e ? "true" : undefined}
                title={isDefault ? "The model's default" : undefined}
              >
                <input
                  id={id}
                  type="radio"
                  name={`${props.idBase}-effort`}
                  value={e}
                  checked={props.effort === e}
                  onChange={() => props.onChange(e)}
                />
                {effortLabel(e)}
              </label>
            );
          })}
        </div>
      )}
      {props.error && <div className="rg-field__error">{props.error}</div>}
    </fieldset>
  );
}

export function RepoPicker(props: {
  idBase: string;
  repos: readonly SpawnRepoOption[];
  repoId: string;
  onChange: (repoId: string) => void;
  error?: string;
}) {
  return (
    <fieldset className="rg-spawn__group">
      <legend className="rg-field__label">Repo</legend>
      {props.repos.length === 0 ? (
        <p className="rg-field__hint rg-spawn__none">This operation has no repos yet.</p>
      ) : (
        <div className="rg-spawn__repos">
          {props.repos.map((r) => {
            const id = `${props.idBase}-${r.repoId}`;
            const checked = props.repoId === r.repoId;
            return (
              <label
                key={r.repoId}
                htmlFor={id}
                className="rg-spawn__option"
                data-checked={checked ? "true" : undefined}
                data-disabled={r.ready ? undefined : "true"}
              >
                <input
                  id={id}
                  type="radio"
                  name={`${props.idBase}-repo`}
                  value={r.repoId}
                  checked={checked}
                  disabled={!r.ready}
                  onChange={() => props.onChange(r.repoId)}
                />
                <span className="rg-spawn__option-text">
                  <span className="rg-spawn__option-title">{r.label}</span>
                  {!r.ready && <span className="rg-spawn__option-hint">Not cloned yet</span>}
                </span>
              </label>
            );
          })}
        </div>
      )}
      {props.error && <div className="rg-field__error">{props.error}</div>}
    </fieldset>
  );
}
