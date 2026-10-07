/**
 * One office agent in Settings → Agents (#271): what it is and how it is
 * doing for everyone who may see it; chat for those who may talk to it;
 * start, stop, privileges, operations, tokens and delete for those who may
 * configure it. An admin looking at someone's personal agent gets "Stop" only.
 */
import {
  mayEmergencyStopOfficeAgent,
  OFFICE_AGENT_PRESETS,
  type OfficeAgentGrant,
  type OfficeAgentPreset,
  type OfficeAgentTokenCreated,
  type OfficeAgentView,
  OPERATION_ACCESSES,
  type OperationAccess,
  type UserRole,
} from "@regulus/protocol";
import { useId, useState } from "react";
import { Button } from "../components/Button.tsx";
import { AgentChat } from "./AgentChat.tsx";
import type { OfficeAgentsApi } from "./api.ts";
import { ago, ENGINE_LABELS, PRESET_LABELS, ROLE_LABELS, STATUS_LABELS } from "./labels.ts";

export interface AgentCardActions {
  start(): void;
  stop(): void;
  remove(): void;
  setPreset(preset: OfficeAgentPreset): void;
  setGrants(grants: OfficeAgentGrant[]): void;
  mintToken(label: string): void;
  revokeToken(tokenId: string): void;
}

export function AgentCard({
  api,
  agent,
  viewer,
  operations,
  busy,
  now,
  minted,
  actions,
}: {
  api: OfficeAgentsApi;
  agent: OfficeAgentView;
  viewer: { id: string; role: UserRole };
  operations: ReadonlyArray<{ operationId: string; name: string }>;
  busy: boolean;
  now: number;
  /** A token minted just now for this agent: shown once, gone on the next refresh. */
  minted: OfficeAgentTokenCreated | null;
  actions: AgentCardActions;
}) {
  const [chatting, setChatting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const presetId = useId();
  const shared = agent.owner.kind === "office";
  const emergency = mayEmergencyStopOfficeAgent(viewer, {
    ownerUserId: agent.owner.kind === "user" ? agent.owner.userId : null,
  });
  const running = agent.status !== "stopped" && agent.status !== "error";
  const grantOf = (operationId: string): OperationAccess | "" =>
    agent.config?.grants.find((g) => g.operationId === operationId)?.access ?? "";
  const changeGrant = (operationId: string, access: string) => {
    const others = (agent.config?.grants ?? []).filter((g) => g.operationId !== operationId);
    actions.setGrants(
      access ? [...others, { operationId, access: access as OperationAccess }] : others,
    );
  };

  return (
    <article className="rg-office-agent" aria-label={agent.name}>
      <header className="rg-office-agent__head">
        <strong className="rg-office-agent__name">{agent.name}</strong>
        <span className={`rg-office-agent__status is-${agent.status}`}>
          {STATUS_LABELS[agent.status]}
        </span>
      </header>
      <div className="rg-office-agent__facts">
        <span>
          {shared
            ? "Shared"
            : `Personal: ${agent.owner.kind === "user" ? agent.owner.displayName : ""}`}
        </span>
        <span>{ROLE_LABELS[agent.role]}</span>
        <span>{ENGINE_LABELS[agent.engine]}</span>
        <span>{agent.model}</span>
        <span>{PRESET_LABELS[agent.preset]}</span>
        <span>Last active {ago(agent.lastActivityAt, now)}</span>
      </div>
      {agent.statusReason && <div className="rg-field__hint">{agent.statusReason}</div>}
      <div className="rg-office-agent__actions">
        {agent.canTalk && (
          <Button variant="primary" size="sm" onClick={() => setChatting((v) => !v)}>
            {chatting ? "Close chat" : "Chat"}
          </Button>
        )}
        {agent.canConfigure && !running && (
          <Button size="sm" disabled={busy} onClick={actions.start}>
            Start
          </Button>
        )}
        {(agent.canConfigure || emergency) && running && (
          <Button size="sm" disabled={busy} onClick={actions.stop}>
            {emergency ? "Emergency stop" : "Stop"}
          </Button>
        )}
        {agent.canConfigure &&
          (confirming ? (
            <>
              <Button variant="destructive" size="sm" disabled={busy} onClick={actions.remove}>
                Delete {agent.name} for good
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
                Keep
              </Button>
            </>
          ) : (
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => setConfirming(true)}>
              Delete…
            </Button>
          ))}
      </div>
      {!agent.canTalk && !agent.canConfigure && (
        <div className="rg-field__hint">
          A personal agent: only the person it belongs to can talk to it or read what it knows.
        </div>
      )}
      {chatting && agent.canTalk && (
        <AgentChat api={api} agentId={agent.id} agentName={agent.name} />
      )}
      {agent.config && (
        <details className="rg-office-agent__config">
          <summary>Privileges, operations and tokens</summary>
          <label className="rg-field__label" htmlFor={presetId}>
            Privileges
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
                {PRESET_LABELS[p]}
              </option>
            ))}
          </select>
          {shared ? (
            <fieldset className="rg-office-agent__grants">
              <legend className="rg-field__label">Operations it may work in</legend>
              {operations.length === 0 && <span className="rg-muted">No operations yet.</span>}
              {operations.map((op) => (
                <label key={op.operationId} className="rg-office-agent__grant">
                  <span>{op.name}</span>
                  <select
                    className="rg-input"
                    aria-label={`Access to ${op.name}`}
                    value={grantOf(op.operationId)}
                    disabled={busy}
                    onChange={(e) => changeGrant(op.operationId, e.currentTarget.value)}
                  >
                    <option value="">No access</option>
                    {[...OPERATION_ACCESSES].reverse().map((a) => (
                      <option key={a} value={a}>
                        {a}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </fieldset>
          ) : (
            <div className="rg-field__hint">
              It can reach exactly the operations you can, with your rights, never more.
            </div>
          )}
          <div className="rg-field__label">Tokens for an external engine (MCP or REST)</div>
          {agent.config.tokens.length === 0 && <div className="rg-muted">No tokens.</div>}
          <ul className="rg-office-agent__tokens">
            {agent.config.tokens.map((t) => (
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
                  Revoke
                </Button>
              </li>
            ))}
          </ul>
          <div>
            <Button size="sm" disabled={busy} onClick={() => actions.mintToken("External engine")}>
              Create a token
            </Button>
          </div>
          {minted && (
            <div className="rg-office-agent__minted" role="alert">
              <div>Copy this token now. It is not shown again.</div>
              <code>{minted.token}</code>
            </div>
          )}
        </details>
      )}
    </article>
  );
}
