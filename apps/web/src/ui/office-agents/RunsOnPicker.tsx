/**
 * "Runs on" and "Model" in the agent form (#280): one list of what the person
 * (or, for a shared agent, the office) has connected, then the known models
 * for that choice with the cheap and the strong one marked. The model options
 * use the spawn dialog's option cards and the protocol's model data. Any other
 * model id stays possible behind "Other…".
 */
import {
  agentModelsFor,
  type OfficeAgentRunsOnResponse,
  type RunsOnChoice,
} from "@regulus/protocol";
import { type RefObject, useEffect, useId, useState } from "react";
import type { OfficeAgentsApi } from "./api.ts";
import { runsOnOptionLabel, TIER_LABELS } from "./labels.ts";
import "../spawn/spawn.css";

export interface RunsOnState {
  /** Null while loading. */
  choices: OfficeAgentRunsOnResponse | null;
  /** The viewer's own Claude login: true, false, null = unknown, undefined = still checking. */
  login: boolean | null | undefined;
}

export function useRunsOn(api: OfficeAgentsApi): RunsOnState {
  const [state, setState] = useState<RunsOnState>({ choices: null, login: undefined });
  useEffect(() => {
    let live = true;
    void Promise.all([api.runsOn(), api.claudeLogin()]).then(([choices, login]) => {
      if (live)
        setState({ choices: choices.ok ? choices.data : { personal: [], shared: [] }, login });
    });
    return () => {
      live = false;
    };
  }, [api]);
  return state;
}

/** The value of a choice in the list: its profile id, "" for the owner's own login. */
export const keyOf = (choice: RunsOnChoice) => choice.profileId ?? "";

/** What can really be used: a login known to be missing cannot. */
export function usableChoices(state: RunsOnState, shared: boolean): RunsOnChoice[] {
  const all = (shared ? state.choices?.shared : state.choices?.personal) ?? [];
  return all.filter((c) => c.kind !== "login" || state.login !== false);
}

/** Shown as the model value when the person types their own. */
export const OTHER_MODEL = "__other__";

export function RunsOnPicker({
  state,
  shared,
  value,
  onChange,
  model,
  onModel,
  customRef,
  customDefault,
  onConnect,
}: {
  state: RunsOnState;
  shared: boolean;
  /** The chosen option ({@link keyOf}); undefined when nothing usable is connected. */
  value: RunsOnChoice | undefined;
  onChange: (key: string) => void;
  /** A listed model id, or {@link OTHER_MODEL}. */
  model: string;
  onModel: (model: string) => void;
  /** The "Other…" text field (uncontrolled, read on submit). */
  customRef: RefObject<HTMLInputElement | null>;
  customDefault: string;
  onConnect: () => void;
}) {
  const ids = { runsOn: useId(), custom: useId(), model: useId() };
  const all = (shared ? state.choices?.shared : state.choices?.personal) ?? [];
  const loading = state.choices === null;
  const models = value ? agentModelsFor(value.kind) : [];
  return (
    <>
      <label className="rg-field__label" htmlFor={ids.runsOn}>
        Runs on
      </label>
      <select
        id={ids.runsOn}
        className="rg-input"
        value={value ? keyOf(value) : ""}
        disabled={loading || !value}
        onChange={(e) => onChange(e.currentTarget.value)}
      >
        {loading && <option value="">Checking what is connected…</option>}
        {!loading && !value && <option value="">Nothing connected yet</option>}
        {all.map((c) => (
          <option
            key={keyOf(c)}
            value={keyOf(c)}
            disabled={c.kind === "login" && state.login === false}
          >
            {runsOnOptionLabel(c, state.login)}
          </option>
        ))}
      </select>
      <div className="rg-field__hint">
        {shared
          ? "Which of the office's own pay-per-use keys does its thinking. A shared agent never uses a person's login."
          : "Whose account does its thinking and pays for it. Only what you have connected is listed."}
      </div>
      {!loading && !value && (
        <div className="rg-office-agent-form__missing" role="note">
          {shared
            ? "The office has no key of its own yet, so a shared agent has nothing to run on. Add one first (for example DeepSeek or an Anthropic API key), then come back."
            : "You have not connected anything this agent can run on. Sign in to Claude or add a key (for example DeepSeek) first, then come back."}{" "}
          <button type="button" className="rg-spawn__link" onClick={onConnect}>
            Open Connect providers
          </button>
        </div>
      )}
      {value && (
        <fieldset className="rg-office-agent-form__group">
          <legend className="rg-field__label">Model</legend>
          <div className="rg-office-agent-form__models">
            {[...models, null].map((m) => {
              const id = m?.id ?? OTHER_MODEL;
              const optionId = `${ids.model}-${id}`;
              const checked = model === id;
              return (
                <label
                  key={id}
                  className="rg-spawn__option"
                  htmlFor={optionId}
                  data-checked={checked ? "true" : undefined}
                >
                  <input
                    id={optionId}
                    type="radio"
                    name={ids.model}
                    value={id}
                    checked={checked}
                    onChange={() => onModel(id)}
                  />
                  <span className="rg-spawn__option-text">
                    <span className="rg-spawn__option-title">
                      {m?.label ?? "Other…"}
                      {m?.tier && (
                        <span className={`rg-office-agent-form__tier is-${m.tier}`}>
                          {TIER_LABELS[m.tier]}
                        </span>
                      )}
                    </span>
                    <span className="rg-spawn__option-hint">
                      {m ? m.hint : "Type a model name yourself"}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
          {model === OTHER_MODEL && (
            <>
              <label className="rg-field__label" htmlFor={ids.custom}>
                Model name
              </label>
              <input
                id={ids.custom}
                className="rg-input"
                ref={customRef}
                defaultValue={customDefault}
                maxLength={100}
                autoComplete="off"
                placeholder="exactly as the provider writes it"
              />
            </>
          )}
          <div className="rg-field__hint">
            The model that does the thinking. Stronger models cost more per message.
          </div>
        </fieldset>
      )}
    </>
  );
}
