/**
 * Settings → Agents: the form for a new office agent (#271). A shared agent
 * (owners and admins) must name an office-wide key; a personal one runs on
 * its owner's own login unless they pick a key.
 */
import {
  type CreateOfficeAgent,
  type CredentialProfileSummary,
  DEFAULT_OFFICE_AGENT_PRESET,
  OFFICE_AGENT_LIMITS,
  OFFICE_AGENT_PRESETS,
  OFFICE_AGENT_ROLES,
  type OfficeAgentEngineKind,
  type OfficeAgentPreset,
  type OfficeAgentRole,
} from "@regulus/protocol";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "../components/Button.tsx";
import type { OfficeAgentsApi } from "./api.ts";
import { ENGINE_LABELS, PRESET_HINTS, PRESET_LABELS, ROLE_LABELS } from "./labels.ts";

export function AgentForm({
  api,
  engines,
  canCreateShared,
  busy,
  onSubmit,
  onCancel,
}: {
  api: OfficeAgentsApi;
  engines: readonly OfficeAgentEngineKind[];
  canCreateShared: boolean;
  busy: boolean;
  onSubmit: (input: CreateOfficeAgent) => void;
  onCancel: () => void;
}) {
  const ids = {
    name: useId(),
    owner: useId(),
    engine: useId(),
    role: useId(),
    preset: useId(),
    model: useId(),
    profile: useId(),
    instructions: useId(),
  };
  // Text fields are uncontrolled, like the office's other forms: read on submit.
  const nameRef = useRef<HTMLInputElement>(null);
  const modelRef = useRef<HTMLInputElement>(null);
  const instructionsRef = useRef<HTMLTextAreaElement>(null);
  const [owner, setOwner] = useState<"me" | "office">("me");
  const [engine, setEngine] = useState<OfficeAgentEngineKind>(engines[0] ?? "cli-session");
  const [role, setRole] = useState<OfficeAgentRole>("assistant");
  const [preset, setPreset] = useState<OfficeAgentPreset>(DEFAULT_OFFICE_AGENT_PRESET);
  const [profileId, setProfileId] = useState("");
  const [profiles, setProfiles] = useState<CredentialProfileSummary[]>([]);

  useEffect(() => {
    let live = true;
    void api.profiles("claude-code").then((res) => {
      if (live && res.ok) setProfiles(res.data.profiles);
    });
    return () => {
      live = false;
    };
  }, [api]);

  const shared = owner === "office";
  const choices = profiles.filter((p) => (shared ? p.owner === "office" : true));
  // A shared agent never runs on a person's login: the first office key is preselected.
  const chosen = shared && !choices.some((p) => p.id === profileId) ? choices[0]?.id : profileId;
  const blocked = shared && !chosen;

  const submit = () => {
    const name = nameRef.current?.value.trim() ?? "";
    const model = modelRef.current?.value.trim() ?? "";
    if (!name) return nameRef.current?.focus();
    if (!model) return modelRef.current?.focus();
    if (blocked) return;
    onSubmit({
      name,
      owner,
      engine,
      role,
      preset,
      provider: "claude-code",
      model,
      instructions: instructionsRef.current?.value ?? "",
      ...(chosen ? { profileId: chosen } : {}),
    });
  };

  return (
    <form
      className="rg-office-agent-form"
      aria-label="New agent"
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
        required
      />
      <div className="rg-field__hint">Permanent and unique in the office.</div>
      {canCreateShared && (
        <>
          <label className="rg-field__label" htmlFor={ids.owner}>
            Belongs to
          </label>
          <select
            id={ids.owner}
            className="rg-input"
            value={owner}
            onChange={(e) => setOwner(e.currentTarget.value as "me" | "office")}
          >
            <option value="me">Me (a personal agent only I can talk to)</option>
            <option value="office">The office (shared by everyone)</option>
          </select>
        </>
      )}
      <label className="rg-field__label" htmlFor={ids.engine}>
        Engine
      </label>
      <select
        id={ids.engine}
        className="rg-input"
        value={engine}
        onChange={(e) => setEngine(e.currentTarget.value as OfficeAgentEngineKind)}
      >
        {engines.map((kind) => (
          <option key={kind} value={kind}>
            {ENGINE_LABELS[kind]}
          </option>
        ))}
      </select>
      <label className="rg-field__label" htmlFor={ids.role}>
        Role
      </label>
      <select
        id={ids.role}
        className="rg-input"
        value={role}
        onChange={(e) => setRole(e.currentTarget.value as OfficeAgentRole)}
      >
        {OFFICE_AGENT_ROLES.map((r) => (
          <option key={r} value={r}>
            {ROLE_LABELS[r]}
          </option>
        ))}
      </select>
      <label className="rg-field__label" htmlFor={ids.preset}>
        Privileges
      </label>
      <select
        id={ids.preset}
        className="rg-input"
        value={preset}
        onChange={(e) => setPreset(e.currentTarget.value as OfficeAgentPreset)}
      >
        {OFFICE_AGENT_PRESETS.map((p) => (
          <option key={p} value={p}>
            {PRESET_LABELS[p]}
          </option>
        ))}
      </select>
      <div className="rg-field__hint">
        {PRESET_HINTS[preset]}{" "}
        {shared
          ? "A shared agent also needs operations granted to it."
          : "A personal agent never has more rights than you."}
      </div>
      <label className="rg-field__label" htmlFor={ids.model}>
        Model
      </label>
      <input
        id={ids.model}
        className="rg-input"
        ref={modelRef}
        defaultValue="sonnet"
        maxLength={100}
        required
      />
      <label className="rg-field__label" htmlFor={ids.profile}>
        Runs on
      </label>
      <select
        id={ids.profile}
        className="rg-input"
        value={chosen ?? ""}
        onChange={(e) => setProfileId(e.currentTarget.value)}
      >
        {!shared && <option value="">My Claude Code login</option>}
        {choices.map((p) => (
          <option key={p.id} value={p.id}>
            {p.owner === "office" ? `Office key: ${p.label}` : `My key: ${p.label}`}
          </option>
        ))}
      </select>
      {blocked && (
        <div className="rg-field__hint" role="note">
          A shared agent runs on an office-wide key only, never on anyone's subscription login. Add
          an office key under Connect providers first.
        </div>
      )}
      <label className="rg-field__label" htmlFor={ids.instructions}>
        Instructions
      </label>
      <textarea
        id={ids.instructions}
        className="rg-input"
        rows={4}
        ref={instructionsRef}
        maxLength={OFFICE_AGENT_LIMITS.instructionsMax}
        placeholder="What this agent is for and how it should work."
      />
      <div className="rg-office-agent__actions">
        <Button type="submit" variant="primary" size="sm" disabled={busy || blocked}>
          Create agent
        </Button>
        <Button variant="ghost" size="sm" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
