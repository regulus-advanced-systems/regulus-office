/**
 * Settings → Agents: the form for a new office agent, and for changing one
 * (#271, #280). Every field says in plain words what it is. "Runs on" lists
 * only what is really connected: the owner's own login and keys for a personal
 * agent, the office's own keys for a shared one (SPEC §8: never a person's
 * login). The name, who it belongs to and what it runs as never change.
 */
import {
  agentModelsFor,
  type CreateOfficeAgent,
  DEFAULT_OFFICE_AGENT_APPEARANCE,
  DEFAULT_OFFICE_AGENT_PRESET,
  defaultAgentModel,
  OFFICE_AGENT_LIMITS,
  OFFICE_AGENT_PRESETS,
  OFFICE_AGENT_ROLES,
  type OfficeAgentEngineKind,
  type OfficeAgentPreset,
  type OfficeAgentRole,
  type OfficeAgentView,
  type UpdateOfficeAgent,
} from "@regulus/protocol";
import { useId, useRef, useState } from "react";
import { Button } from "../components/Button.tsx";
import { AppearancePicker } from "./AppearancePicker.tsx";
import type { OfficeAgentsApi } from "./api.ts";
import { ENGINE_HELP, ENGINE_WORDS, PRESET_WORDS, ROLE_WORDS, SOUL_WORDS } from "./labels.ts";
import { keyOf, OTHER_MODEL, RunsOnPicker, usableChoices, useRunsOn } from "./RunsOnPicker.tsx";

type Common = {
  api: OfficeAgentsApi;
  busy: boolean;
  onCancel: () => void;
  /** Open "Connect providers" (when nothing usable is connected). */
  onConnect: () => void;
};
export type AgentFormProps = Common &
  (
    | {
        /** Absent: a new agent. */
        agent?: undefined;
        engines: readonly OfficeAgentEngineKind[];
        canCreateShared: boolean;
        onCreate: (input: CreateOfficeAgent) => void;
      }
    | { agent: OfficeAgentView; onSave: (patch: UpdateOfficeAgent) => void }
  );

export function AgentForm(props: AgentFormProps) {
  const { api, busy, agent } = props;
  const ids = {
    name: useId(),
    owner: useId(),
    engine: useId(),
    role: useId(),
    preset: useId(),
    instructions: useId(),
  };
  // Text fields are uncontrolled, like the office's other forms: read on submit.
  const nameRef = useRef<HTMLInputElement>(null);
  const customRef = useRef<HTMLInputElement>(null);
  const instructionsRef = useRef<HTMLTextAreaElement>(null);
  const engines = agent ? [agent.engine] : props.engines;
  const [owner, setOwner] = useState<"me" | "office">(
    agent?.owner.kind === "office" ? "office" : "me",
  );
  const [engine, setEngine] = useState<OfficeAgentEngineKind>(engines[0] ?? "cli-session");
  const [role, setRole] = useState<OfficeAgentRole>(agent?.role ?? "assistant");
  const [preset, setPreset] = useState<OfficeAgentPreset>(
    agent?.preset ?? DEFAULT_OFFICE_AGENT_PRESET,
  );
  const [appearance, setAppearance] = useState(
    agent?.appearance ?? DEFAULT_OFFICE_AGENT_APPEARANCE,
  );
  // What the person picked; until they do, the agent's own choice or the first usable one.
  const [pickedKey, setPickedKey] = useState<string | undefined>(
    agent ? (agent.config?.profileId ?? "") : undefined,
  );
  const [pickedModel, setPickedModel] = useState<string | undefined>(agent?.model);

  const runsOn = useRunsOn(api);
  const shared = owner === "office";
  const usable = usableChoices(runsOn, shared);
  const chosen = usable.find((c) => keyOf(c) === pickedKey) ?? usable[0];
  const known = chosen ? agentModelsFor(chosen.kind) : [];
  const model =
    pickedModel === undefined
      ? chosen
        ? defaultAgentModel(chosen.kind)
        : ""
      : known.some((m) => m.id === pickedModel)
        ? pickedModel
        : OTHER_MODEL;
  const picksModel = engine === "cli-session";
  const blocked = picksModel && !chosen;

  const submit = () => {
    const name = nameRef.current?.value.trim() ?? "";
    if (!agent && !name) return nameRef.current?.focus();
    if (blocked) return;
    const typed = customRef.current?.value.trim() ?? "";
    const modelId = model === OTHER_MODEL ? typed : model;
    if (picksModel && !modelId) return customRef.current?.focus();
    const instructions = instructionsRef.current?.value ?? "";
    const profileId = chosen?.profileId;
    if (agent) {
      // Only what changed: a change of looks alone does not restart a running agent.
      const patch: UpdateOfficeAgent = {};
      if (role !== agent.role) patch.role = role;
      if (preset !== agent.preset) patch.preset = preset;
      if (appearance !== agent.appearance) patch.appearance = appearance;
      if (picksModel && modelId !== agent.model) patch.model = modelId;
      if (picksModel && (profileId ?? null) !== (agent.config?.profileId ?? null)) {
        patch.profileId = profileId ?? null;
      }
      if (Object.keys(patch).length === 0) props.onCancel();
      else props.onSave(patch);
      return;
    }
    props.onCreate({
      name,
      owner,
      engine,
      role,
      preset,
      provider: chosen?.provider ?? "claude-code",
      model: modelId || "default",
      appearance,
      instructions,
      ...(profileId ? { profileId } : {}),
    });
  };

  return (
    <form
      className="rg-office-agent-form"
      aria-label={agent ? `Change ${agent.name}` : "New agent"}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <label className="rg-field__label" htmlFor={ids.name}>
        Name
      </label>
      <input
        id={ids.name}
        className="rg-input"
        ref={nameRef}
        maxLength={OFFICE_AGENT_LIMITS.nameMax}
        placeholder="Number Two"
        defaultValue={agent?.name}
        disabled={agent !== undefined}
        required
      />
      <div className="rg-field__hint">
        {agent
          ? "A name is for life: it cannot be changed."
          : "What everyone calls it. A name is for life and no two agents share one."}
      </div>
      {(agent || props.canCreateShared) && (
        <>
          <label className="rg-field__label" htmlFor={ids.owner}>
            Belongs to
          </label>
          <select
            id={ids.owner}
            className="rg-input"
            value={owner}
            disabled={agent !== undefined}
            onChange={(e) => {
              setOwner(e.currentTarget.value as "me" | "office");
              setPickedKey(undefined);
              setPickedModel(undefined);
            }}
          >
            <option value="me">
              {agent?.owner.kind === "user" ? agent.owner.displayName : "Me"} (a personal agent only
              its owner can talk to)
            </option>
            <option value="office">The office (shared: every member can talk to it)</option>
          </select>
          <div className="rg-field__hint">
            {shared
              ? "A shared agent works for everyone and is paid for by the office's own key."
              : "A personal agent works for one person, with that person's rights and nothing more."}
          </div>
        </>
      )}
      <label className="rg-field__label" htmlFor={ids.engine}>
        Runs as
      </label>
      <select
        id={ids.engine}
        className="rg-input"
        value={engine}
        disabled={agent !== undefined}
        onChange={(e) => setEngine(e.currentTarget.value as OfficeAgentEngineKind)}
      >
        {engines.map((kind) => (
          <option key={kind} value={kind}>
            {ENGINE_WORDS[kind].label}
          </option>
        ))}
      </select>
      <div className="rg-field__hint">
        {ENGINE_HELP} {ENGINE_WORDS[engine].hint}
        {agent ? " It cannot be changed afterwards." : ""}
      </div>
      {picksModel ? (
        <RunsOnPicker
          state={runsOn}
          shared={shared}
          value={chosen}
          onChange={(key) => {
            setPickedKey(key);
            setPickedModel(undefined);
          }}
          model={model}
          onModel={setPickedModel}
          customRef={customRef}
          customDefault={
            model === OTHER_MODEL && pickedModel !== OTHER_MODEL ? (pickedModel ?? "") : ""
          }
          onConnect={props.onConnect}
        />
      ) : (
        <div className="rg-field__hint">This program brings its own provider and model.</div>
      )}
      <label className="rg-field__label" htmlFor={ids.role}>
        Job
      </label>
      <select
        id={ids.role}
        className="rg-input"
        value={role}
        onChange={(e) => setRole(e.currentTarget.value as OfficeAgentRole)}
      >
        {OFFICE_AGENT_ROLES.map((r) => (
          <option key={r} value={r}>
            {ROLE_WORDS[r].label}
          </option>
        ))}
      </select>
      <div className="rg-field__hint">{ROLE_WORDS[role].hint}</div>
      <label className="rg-field__label" htmlFor={ids.preset}>
        What it may do
      </label>
      <select
        id={ids.preset}
        className="rg-input"
        value={preset}
        onChange={(e) => setPreset(e.currentTarget.value as OfficeAgentPreset)}
      >
        {OFFICE_AGENT_PRESETS.map((p) => (
          <option key={p} value={p}>
            {PRESET_WORDS[p].label}
          </option>
        ))}
      </select>
      <div className="rg-field__hint">
        {PRESET_WORDS[preset].hint}{" "}
        {shared
          ? "A shared agent sees no operation until you let it into one (on its card, after creating it)."
          : "A personal agent can never do more than its owner."}
      </div>
      <AppearancePicker value={appearance} onChange={setAppearance} />
      {/* Changing it later, with its history, is on the agent's card (#136). */}
      {!agent && (
        <>
          <label className="rg-field__label" htmlFor={ids.instructions}>
            {SOUL_WORDS.label}
          </label>
          <textarea
            id={ids.instructions}
            className="rg-input"
            rows={4}
            ref={instructionsRef}
            maxLength={OFFICE_AGENT_LIMITS.instructionsMax}
            placeholder="What this agent is for, how it should talk, what it should always or never do."
          />
          <div className="rg-field__hint">
            {SOUL_WORDS.hint} You can change it on its card at any time and go back to an older
            version.
          </div>
        </>
      )}
      <div className="rg-office-agent__actions">
        <Button type="submit" variant="primary" size="sm" disabled={busy || blocked}>
          {agent ? "Save changes" : "Create agent"}
        </Button>
        <Button variant="ghost" size="sm" disabled={busy} onClick={props.onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
