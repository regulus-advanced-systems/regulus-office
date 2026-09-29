/**
 * The spawn dialog's model picker (#142): one radio group, grouped by
 * provider. Arrow keys move through every model; the models of a provider the
 * human has not connected (no login and no key) are shown but disabled, with
 * a "Connect" link to the providers panel (#32) in that provider's header.
 */
import type { ProviderId } from "@regulus/protocol";
import type { Ref } from "react";
import { type AccessByProvider, providerUsable } from "./credentials.ts";
import { PROVIDER_PRESETS } from "./models.ts";

export interface ModelPickerProps {
  /** Prefix for element ids and the radio group's name. */
  idBase: string;
  provider: ProviderId;
  model: string;
  access: AccessByProvider;
  onChange: (provider: ProviderId, model: string) => void;
  onConnect: (provider: ProviderId) => void;
  /** Attached to the checked radio: the dialog's first focus. */
  focusRef?: Ref<HTMLInputElement>;
  error?: string;
}

function status(login: boolean | null | undefined, keys: number, usable: boolean): string {
  if (!usable) return "Not connected";
  if (login === true) return "Your login";
  if (keys > 0) return login === undefined ? "Checking…" : "Using a key";
  return login === undefined ? "Checking…" : "";
}

export function ModelPicker(props: ModelPickerProps) {
  const { idBase, access, error } = props;
  const errorId = `${idBase}-error`;
  return (
    <fieldset
      className="rg-spawn__group"
      aria-invalid={error ? true : undefined}
      aria-describedby={error ? errorId : undefined}
    >
      <legend className="rg-field__label">Model</legend>
      <div className="rg-spawn__providers">
        {PROVIDER_PRESETS.map((p) => {
          const a = access[p.id];
          const usable = providerUsable(a);
          const headId = `${idBase}-${p.id}`;
          const note = status(a?.login, a?.profiles.length ?? 0, usable);
          return (
            <div
              key={p.id}
              className="rg-spawn__provider"
              role="group"
              aria-labelledby={headId}
              data-connected={usable ? "true" : "false"}
            >
              <div className="rg-spawn__provider-head">
                <span id={headId} className="rg-spawn__provider-name">
                  {p.label}
                </span>
                {usable ? (
                  note && <span className="rg-spawn__provider-note">{note}</span>
                ) : (
                  <button
                    type="button"
                    className="rg-spawn__link"
                    onClick={() => props.onConnect(p.id)}
                  >
                    Connect {p.label}
                  </button>
                )}
              </div>
              {p.models.map((m) => {
                const checked = props.provider === p.id && props.model === m.id;
                const optionId = `${idBase}-${p.id}-${m.id}`;
                return (
                  <label
                    key={m.id}
                    className="rg-spawn__option"
                    htmlFor={optionId}
                    data-checked={checked ? "true" : undefined}
                    data-disabled={usable ? undefined : "true"}
                  >
                    <input
                      id={optionId}
                      ref={checked ? props.focusRef : undefined}
                      type="radio"
                      name={`${idBase}-model`}
                      value={`${p.id}:${m.id}`}
                      checked={checked}
                      disabled={!usable}
                      aria-describedby={`${optionId}-hint`}
                      onChange={() => props.onChange(p.id, m.id)}
                    />
                    <span className="rg-spawn__option-text">
                      <span className="rg-spawn__option-title">{m.label}</span>
                      <span id={`${optionId}-hint`} className="rg-spawn__option-hint">
                        {m.hint}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          );
        })}
      </div>
      {error && (
        <div id={errorId} className="rg-field__error">
          {error}
        </div>
      )}
    </fieldset>
  );
}
