/**
 * One office agent in Settings → Agents (#271, #280): how it looks, what it
 * is, what it runs on and how it is doing, for everyone who may see it; chat
 * for those who may talk to it; start, stop, change, delete and its access
 * settings for those who may configure it. An admin looking at someone's
 * personal agent gets "Stop" only.
 */
import {
  agentModelLabel,
  engineBringsOwnModel,
  type HermesConnectionInput,
  mayEmergencyStopOfficeAgent,
  type OfficeAgentTokenCreated,
  type OfficeAgentView,
  officeAgentAppearanceLabel,
  type UpdateOfficeAgent,
  type UserRole,
} from "@regulus/protocol";
import { useEffect, useState } from "react";
import { Button } from "../components/Button.tsx";
import { AgentAccess, type AgentAccessActions } from "./AgentAccess.tsx";
import { AgentChat } from "./AgentChat.tsx";
import { AgentForm } from "./AgentForm.tsx";
import { AppearanceThumb } from "./AppearancePicker.tsx";
import type { OfficeAgentsApi } from "./api.ts";
import { useChatRequest } from "./chatRequest.ts";
import { HermesConnectionSection } from "./HermesConnection.tsx";
import {
  ago,
  engineName,
  PRESET_WORDS,
  ROLE_WORDS,
  runsOnSummary,
  STATUS_LABELS,
} from "./labels.ts";

export interface AgentCardActions extends AgentAccessActions {
  start(): void;
  stop(): void;
  remove(): void;
  /** Resolves true when the change was saved. */
  update(patch: UpdateOfficeAgent): Promise<boolean>;
  connect(): void;
  /** Replace the connection to the owner's Hermes (#58). Resolves true when it was stored. */
  setHermes(input: HermesConnectionInput): Promise<boolean>;
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
  /** An access code made just now for this agent: shown once, gone on the next refresh. */
  minted: OfficeAgentTokenCreated | null;
  actions: AgentCardActions;
}) {
  const [chatting, setChatting] = useState(false);
  const [editing, setEditing] = useState(false);
  // Asked for from the world (a click on this agent's bubble, #256): open the chat once.
  const requested = useChatRequest((s) => s.agentId === agent.id);
  const taken = useChatRequest((s) => s.taken);
  useEffect(() => {
    if (!requested) return;
    if (agent.canTalk) setChatting(true);
    taken(agent.id);
  }, [requested, agent.canTalk, agent.id, taken]);
  const [confirming, setConfirming] = useState(false);
  const shared = agent.owner.kind === "office";
  const emergency = mayEmergencyStopOfficeAgent(viewer, {
    ownerUserId: agent.owner.kind === "user" ? agent.owner.userId : null,
  });
  const running = agent.status !== "stopped" && agent.status !== "error";
  const kind = agent.runsOn.kind === "unknown" ? undefined : agent.runsOn.kind;

  return (
    <article className="rg-office-agent" aria-label={agent.name}>
      <header className="rg-office-agent__head">
        <AppearanceThumb id={agent.appearance} size="sm" />
        <div className="rg-office-agent__title">
          <strong className="rg-office-agent__name">{agent.name}</strong>
          <span className={`rg-office-agent__status is-${agent.status}`}>
            {STATUS_LABELS[agent.status]}
          </span>
          <div className="rg-office-agent__facts">
            <span>
              {shared
                ? "Shared by the office"
                : `Personal: ${agent.owner.kind === "user" ? agent.owner.displayName : ""}`}
            </span>
            <span>Job: {ROLE_WORDS[agent.role].label}</span>
            <span>May: {PRESET_WORDS[agent.preset].label}</span>
            <span>Looks: {officeAgentAppearanceLabel(agent.appearance)}</span>
            <span>Last active {ago(agent.lastActivityAt, now)}</span>
          </div>
          <div className="rg-office-agent__facts" data-testid="agent-runs-on">
            <span>Runs as: {engineName(agent.engine)}</span>
            {engineBringsOwnModel(agent.engine) ? (
              <span>Provider and model: its own</span>
            ) : (
              <>
                <span>Runs on: {runsOnSummary(agent.runsOn)}</span>
                <span>Model: {agentModelLabel(kind, agent.model)}</span>
              </>
            )}
          </div>
        </div>
      </header>
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
        {agent.canConfigure && !editing && (
          <Button size="sm" disabled={busy} onClick={() => setEditing(true)}>
            Change…
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
          {shared
            ? "Viewers cannot talk to shared agents: every message spends the office's key."
            : "A personal agent: only the person it belongs to can talk to it or read what it knows."}
        </div>
      )}
      {editing && agent.canConfigure && (
        <AgentForm
          api={api}
          agent={agent}
          busy={busy}
          onSave={(patch) => void actions.update(patch).then((ok) => ok && setEditing(false))}
          onCancel={() => setEditing(false)}
          onConnect={actions.connect}
        />
      )}
      {chatting && agent.canTalk && (
        <AgentChat api={api} agentId={agent.id} agentName={agent.name} />
      )}
      {agent.config && agent.engine === "hermes-external" && (
        <HermesConnectionSection
          api={api}
          agent={agent}
          busy={busy}
          onReplace={actions.setHermes}
        />
      )}
      {agent.config && (
        <AgentAccess
          agent={agent}
          config={agent.config}
          operations={operations}
          busy={busy}
          now={now}
          minted={minted}
          actions={actions}
        />
      )}
    </article>
  );
}
