/**
 * What an office agent may do and reach (#271, #280), for those who may
 * configure it: its level of permission, the operations a shared agent was
 * let into, and the access codes a program outside the office uses to act as
 * this agent. Plain words, one line of help each.
 */
import {
  OFFICE_AGENT_PRESETS,
  type OfficeAgentGrant,
  type OfficeAgentPreset,
  type OfficeAgentTokenCreated,
  type OfficeAgentView,
  OPERATION_ACCESSES,
  type OperationAccess,
} from "@regulus/protocol";
import { useId } from "react";
import { Button } from "../components/Button.tsx";
import { ACCESS_LABELS, ago, PRESET_WORDS } from "./labels.ts";

export interface AgentAccessActions {
  setPreset(preset: OfficeAgentPreset): void;
  setGrants(grants: OfficeAgentGrant[]): void;
  mintToken(label: string): void;
  revokeToken(tokenId: string): void;
}

export function AgentAccess({
  agent,
  config,
  operations,
  busy,
  now,
  minted,
  actions,
}: {
  agent: OfficeAgentView;
  config: NonNullable<OfficeAgentView["config"]>;
  operations: ReadonlyArray<{ operationId: string; name: string }>;
  busy: boolean;
  now: number;
  /** An access code made just now: shown once, gone on the next refresh. */
  minted: OfficeAgentTokenCreated | null;
  actions: AgentAccessActions;
}) {
  const presetId = useId();
  const shared = agent.owner.kind === "office";
  const grantOf = (operationId: string): OperationAccess | "" =>
    config.grants.find((g) => g.operationId === operationId)?.access ?? "";
  const changeGrant = (operationId: string, access: string) => {
    const others = config.grants.filter((g) => g.operationId !== operationId);
    actions.setGrants(
      access ? [...others, { operationId, access: access as OperationAccess }] : others,
    );
  };

  return (
    <details className="rg-office-agent__config">
      <summary>What it may do and where</summary>
      <label className="rg-field__label" htmlFor={presetId}>
        What it may do
      </label>
      <select
        id={presetId}
        className="rg-input"
        value={agent.preset}
        disabled={busy}
        onChange={(e) => actions.setPreset(e.currentTarget.value as OfficeAgentPreset)}
      >
        {OFFICE_AGENT_PRESETS.map((p) => (
          <option key={p} value={p}>
            {PRESET_WORDS[p].label}
          </option>
        ))}
      </select>
      <div className="rg-field__hint">{PRESET_WORDS[agent.preset].hint}</div>
      {shared ? (
        <fieldset className="rg-office-agent__grants">
          <legend className="rg-field__label">Operations it may work in</legend>
          <div className="rg-field__hint">
            A shared agent sees no operation until you let it in here, one by one.
          </div>
          {operations.length === 0 && <span className="rg-muted">No operations yet.</span>}
          {operations.map((op) => (
            <label key={op.operationId} className="rg-office-agent__grant">
              <span>{op.name}</span>
              <select
                className="rg-input"
                aria-label={`What it may do in ${op.name}`}
                value={grantOf(op.operationId)}
                disabled={busy}
                onChange={(e) => changeGrant(op.operationId, e.currentTarget.value)}
              >
                <option value="">Not let in</option>
                {[...OPERATION_ACCESSES].reverse().map((a) => (
                  <option key={a} value={a}>
                    {ACCESS_LABELS[a]}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </fieldset>
      ) : (
        <div className="rg-field__hint">
          It can reach exactly the operations its owner can, with its owner's rights, never more.
        </div>
      )}
      <div className="rg-field__label">Access codes for a program outside the office</div>
      <div className="rg-field__hint">
        Only needed when this agent's program runs somewhere else (your own Hermes, say). The code
        is the password that program uses to act as this agent. Leave this alone otherwise.
      </div>
      {config.tokens.length === 0 && <div className="rg-muted">No access codes.</div>}
      <ul className="rg-office-agent__tokens">
        {config.tokens.map((t) => (
          <li key={t.id}>
            <span>
              {t.label} <span className="rg-muted">(last used {ago(t.lastUsedAt, now)})</span>
            </span>
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => actions.revokeToken(t.id)}
            >
              Remove
            </Button>
          </li>
        ))}
      </ul>
      <div>
        <Button size="sm" disabled={busy} onClick={() => actions.mintToken("Outside program")}>
          Create an access code
        </Button>
      </div>
      {minted && (
        <div className="rg-office-agent__minted" role="alert">
          <div>Copy this access code now. It is not shown again.</div>
          <code>{minted.token}</code>
        </div>
      )}
    </details>
  );
}
