/**
 * One office agent in Settings → Agents (#271, #280): how it looks, what it
 * is, what it runs on and how it is doing, for everyone who may see it; chat
 * for those who may talk to it; start, stop, change, delete and its access
 * settings for those who may configure it, and with them who it is, what it
 * remembers and its notes (#136). An admin looking at someone's personal
 * agent gets "Emergency stop" and "Remove" only, and reads nothing of it.
 */
import {
  agentModelLabel,
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
import { AgentMind } from "./AgentMind.tsx";
import { AppearanceThumb } from "./AppearancePicker.tsx";
import type { OfficeAgentsApi } from "./api.ts";
import { useChatRequest } from "./chatRequest.ts";
import {
  ago,
  costWords,
  engineName,
  PRESET_WORDS,
  ROLE_WORDS,
  runsOnSummary,
  STATUS_LABELS,
} from "./labels.ts";

export interface AgentCardActions extends AgentAccessActions {
  start(): void;
  stop(): void;
  /** Send a personal agent off to roam the lair, or call it back to its owner's side (#252). */
  dismiss(): void;
  recall(): void;
  remove(): void;
  /** Its soul was saved from the card (#136): load the list again. */
  refresh(): void;
  /** Resolves true when the change was saved. */
  update(patch: UpdateOfficeAgent): Promise<boolean>;
  connect(): void;
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
  const cost = costWords(agent.cost?.last30DaysUsd);

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
            {!shared && <span>{agent.dismissed ? "Roaming the lair" : "Follows its owner"}</span>}
            <span>Last active {ago(agent.lastActivityAt, now)}</span>
          </div>
          <div className="rg-office-agent__facts" data-testid="agent-runs-on">
            <span>Runs as: {engineName(agent.engine)}</span>
            <span>Runs on: {runsOnSummary(agent.runsOn)}</span>
            <span>Model: {agentModelLabel(kind, agent.model)}</span>
            {cost && (
              <span title="An estimate from the usage tracker, last 30 days">
                Cost, last 30 days: {cost}
              </span>
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
        {agent.canConfigure && !shared && (
          <Button
            size="sm"
            disabled={busy}
            onClick={agent.dismissed ? actions.recall : actions.dismiss}
            title={
              agent.dismissed
                ? "It comes back to your side and follows you again."
                : "It stops following you and roams the lair until you recall it."
            }
          >
            {agent.dismissed ? "Recall to my side" : "Dismiss"}
          </Button>
        )}
        {agent.canConfigure && !editing && (
          <Button size="sm" disabled={busy} onClick={() => setEditing(true)}>
            Change…
          </Button>
        )}
        {(agent.canConfigure || agent.canRemove) &&
          (confirming ? (
            <>
              <Button variant="destructive" size="sm" disabled={busy} onClick={actions.remove}>
                {agent.canConfigure
                  ? `Delete ${agent.name} for good`
                  : `Remove ${agent.name} and everything it holds, for good`}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
                Keep
              </Button>
            </>
          ) : (
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => setConfirming(true)}>
              {agent.canConfigure ? "Delete…" : "Remove…"}
            </Button>
          ))}
      </div>
      {!agent.canTalk && !agent.canConfigure && (
        <div className="rg-field__hint">
          {shared
            ? "Viewers cannot talk to shared agents: every message spends the office's key."
            : agent.canRemove
              ? "A personal agent: only the person it belongs to can talk to it or read who it is, what it remembers and its notes. As an owner or admin you can stop it or remove it, nothing more."
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
      {agent.config && (
        <AgentMind api={api} agent={agent} now={now} onSoulSaved={actions.refresh} />
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
