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
  DEFAULT_OFFICE_AGENT_PRESET,
  defaultAgentModel,
  defaultOfficeAgentAppearance,
  engineBringsOwnModel,
  engineIsPersonalOnly,
  OFFICE_AGENT_LIMITS,
  OFFICE_AGENT_PRESETS,
  OFFICE_AGENT_ROLES,
  type OfficeAgentEngineKind,
  type OfficeAgentPreset,
  type OfficeAgentRole,
  type OfficeAgentView,
  OWN_MODEL_PLACEHOLDER,
  SHARED_HERMES_NOTE,
  type UpdateOfficeAgent,
} from "@regulus/protocol";
import { useId, useRef, useState } from "react";
import { Button } from "../components/Button.tsx";
import { AppearancePicker } from "./AppearancePicker.tsx";
import type { OfficeAgentsApi } from "./api.ts";
import { HermesFields, readHermesFields, useHermesFieldRefs } from "./HermesConnection.tsx";
import {
  ENGINE_HELP,
  ENGINE_WORDS,
  MANAGED_HERMES_OFF,
  PRESET_WORDS,
  ROLE_WORDS,
  SOUL_WORDS,
} from "./labels.ts";
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
  const hermesRefs = useHermesFieldRefs();
  const [hermesProblem, setHermesProblem] = useState<{ text: string } | null>(null);
  const [owner, setOwner] = useState<"me" | "office">(
    agent?.owner.kind === "office" ? "office" : "me",
  );
  // Hermes (a person's own, or one the office runs) is not offered for a shared agent (#301).
  const engines = (agent ? [agent.engine] : props.engines).filter(
    (kind) => agent !== undefined || owner === "me" || !engineIsPersonalOnly(kind),
  );
  const [pickedEngine, setEngine] = useState<OfficeAgentEngineKind | undefined>(undefined);
  const engine =
    pickedEngine && engines.includes(pickedEngine) ? pickedEngine : (engines[0] ?? "cli-session");
  const [role, setRole] = useState<OfficeAgentRole>(agent?.role ?? "assistant");
  const [preset, setPreset] = useState<OfficeAgentPreset>(
    agent?.preset ?? DEFAULT_OFFICE_AGENT_PRESET,
  );
  // Until a look is picked, a new agent gets the default for its job: the PM suit for a
  // project manager, the jumpsuit otherwise (#60).
  const [pickedAppearance, setAppearance] = useState<string | undefined>(agent?.appearance);
  const appearance = pickedAppearance ?? defaultOfficeAgentAppearance(role);
  // What the person picked; until they do, the agent's own choice or the first usable one.
  const [pickedKey, setPickedKey] = useState<string | undefined>(
    agent ? (agent.config?.profileId ?? "") : undefined,
  );
  const [pickedModel, setPickedModel] = useState<string | undefined>(agent?.model);

  const runsOn = useRunsOn(api);
  const shared = owner === "office";
  const usable = usableChoices(runsOn, shared, engine);
  // The office has no Hermes of its own to start: the choice is shown, greyed out, with what to do.
  const hermesOff = !agent && !props.engines.includes("hermes-managed");
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
  const picksModel = !engineBringsOwnModel(engine);
  const connects = !agent && engine === "hermes-external";
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
    const base = { name, owner, engine, role, preset, appearance, instructions };
    if (connects) {
      const hermes = readHermesFields(hermesRefs);
      if (!hermes.ok) {
        setHermesProblem({ text: hermes.problem });
        return hermes.focus();
      }
      setHermesProblem(null);
      // Hermes brings its own provider and model; the office stores a placeholder.
      props.onCreate({
        ...base,
        provider: "custom",
        model: OWN_MODEL_PLACEHOLDER,
        hermes: hermes.value,
      });
      return;
    }
    props.onCreate({
      ...base,
      provider: chosen?.provider ?? "claude-code",
      model: modelId || (picksModel ? "default" : OWN_MODEL_PLACEHOLDER),
      ...(profileId && picksModel ? { profileId } : {}),
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
        onChange={(e) => {
          setEngine(e.currentTarget.value as OfficeAgentEngineKind);
          // Another program lists other keys and models.
          setPickedKey(undefined);
          setPickedModel(undefined);
        }}
      >
        {engines.map((kind) => (
          <option key={kind} value={kind}>
            {ENGINE_WORDS[kind].label}
          </option>
        ))}
        {hermesOff && (
          <option value="" disabled>
            {MANAGED_HERMES_OFF.option}
          </option>
        )}
      </select>
      <div className="rg-field__hint">
        {ENGINE_HELP} {ENGINE_WORDS[engine].hint}
        {agent ? " It cannot be changed afterwards." : ""}
      </div>
      {hermesOff && <div className="rg-field__hint">{MANAGED_HERMES_OFF.hint}</div>}
      {!agent && shared && props.engines.some(engineIsPersonalOnly) && (
        <div className="rg-field__hint" data-testid="shared-hermes-note">
          {SHARED_HERMES_NOTE}
        </div>
      )}
      {picksModel ? (
        <RunsOnPicker
          state={runsOn}
          shared={shared}
          engine={engine}
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
      ) : connects ? (
        <HermesFields api={api} refs={hermesRefs} problem={hermesProblem} />
      ) : (
        <div className="rg-field__hint">
          This program brings its own provider and model.
          {agent?.engine === "hermes-external"
            ? " Its connection is changed on the agent's card, under Connection to your Hermes."
            : ""}
        </div>
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
