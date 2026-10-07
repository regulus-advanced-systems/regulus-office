/**
 * Settings → Agents (#271; SPEC §10 M5, D20, D28, D32): the office agents
 * the viewer may see, with engine, status, last activity and privileges.
 * Owners and admins create shared agents; each person creates their own
 * personal ones. Questions agents asked the viewer are listed on top.
 */
import type {
  CreateOfficeAgent,
  HumanRequest,
  OfficeAgentsResponse,
  OfficeAgentTokenCreated,
} from "@regulus/protocol";
import { useCallback, useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { selectOperations, useBuildingStore } from "../../state/building.ts";
import { canManageOffice, useSessionStore } from "../../state/session.ts";
import { FormAlert } from "../auth/AuthCard.tsx";
import type { ApiFailure, ApiResult } from "../auth/api.ts";
import { Button } from "../components/Button.tsx";
import { AgentCard } from "./AgentCard.tsx";
import { AgentForm } from "./AgentForm.tsx";
import { createOfficeAgentsApi, describeOfficeAgentsError, type OfficeAgentsApi } from "./api.ts";
import { PendingRequests } from "./PendingRequests.tsx";
import "./officeAgents.css";

const defaultApi = createOfficeAgentsApi();

export function OfficeAgentsSection({
  api = defaultApi,
  now = Date.now,
}: {
  api?: OfficeAgentsApi;
  now?: () => number;
}) {
  const user = useSessionStore((s) => s.user);
  const operations = useBuildingStore(useShallow(selectOperations));
  const [data, setData] = useState<OfficeAgentsResponse | null>(null);
  const [requests, setRequests] = useState<HumanRequest[]>([]);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [minted, setMinted] = useState<{ agentId: string; token: OfficeAgentTokenCreated } | null>(
    null,
  );

  const load = useCallback(async () => {
    const [list, pending] = await Promise.all([api.list(), api.requests()]);
    if (list.ok) setData(list.data);
    else setError(describeOfficeAgentsError(list));
    if (pending.ok) setRequests(pending.data.requests);
  }, [api]);
  useEffect(() => {
    void load();
  }, [load]);

  if (!user) return null;
  const manager = canManageOffice(user.role);

  /** Run one change, show why it failed, then refresh. Returns its data on success. */
  const run = async <T,>(fn: () => Promise<ApiResult<T>>): Promise<T | undefined> => {
    setBusy(true);
    setError(null);
    setMinted(null);
    const res = await fn();
    if (!res.ok) setError(describeOfficeAgentsError(res as ApiFailure));
    await load();
    setBusy(false);
    return res.ok ? res.data : undefined;
  };

  const create = async (input: CreateOfficeAgent) => {
    if (await run(() => api.create(input))) setCreating(false);
  };
  const mine = data?.agents.filter((a) => a.owner.kind === "user" && a.owner.userId === user.id);
  const atCap = data !== null && (mine?.length ?? 0) >= data.settings.personalAgentCap;

  return (
    <section className="rg-settings__group" aria-label="Office agents">
      <h3 className="rg-settings__heading">Office agents</h3>
      <p className="rg-field__hint">
        Long-lived agents that work through the office's own tools. A shared agent serves everyone
        and runs on an office key. A personal agent belongs to one person: it has exactly their
        rights, and only they can talk to it.
      </p>
      <PendingRequests
        requests={requests}
        busy={busy}
        onAnswer={(id, answer) => void run(() => api.answer(id, { answer }))}
      />
      {creating ? (
        <AgentForm
          api={api}
          engines={data?.engines ?? []}
          canCreateShared={manager}
          busy={busy}
          onSubmit={(input) => void create(input)}
          onCancel={() => setCreating(false)}
        />
      ) : (
        <div>
          <Button
            variant="primary"
            size="sm"
            disabled={busy || data === null || data.engines.length === 0 || user.role === "viewer"}
            onClick={() => setCreating(true)}
          >
            New agent…
          </Button>
          {data && !manager && atCap && (
            <span className="rg-field__hint">
              {" "}
              You have {mine?.length} of {data.settings.personalAgentCap} personal agents.
            </span>
          )}
        </div>
      )}
      {data?.agents.length === 0 && !creating && <p className="rg-muted">No agents yet.</p>}
      <div className="rg-office-agents">
        {data?.agents.map((agent) => (
          <AgentCard
            key={agent.id}
            api={api}
            agent={agent}
            viewer={{ id: user.id, role: user.role }}
            operations={operations}
            busy={busy}
            now={now()}
            minted={minted?.agentId === agent.id ? minted.token : null}
            actions={{
              start: () => void run(() => api.start(agent.id)),
              stop: () => void run(() => api.stop(agent.id)),
              remove: () => void run(() => api.remove(agent.id)),
              setPreset: (preset) => void run(() => api.update(agent.id, { preset })),
              setGrants: (grants) => void run(() => api.setGrants(agent.id, grants)),
              revokeToken: (tokenId) => void run(() => api.revokeToken(agent.id, tokenId)),
              mintToken: async (label) => {
                const token = await run(() => api.mintToken(agent.id, label));
                if (token) setMinted({ agentId: agent.id, token });
              },
            }}
          />
        ))}
      </div>
      {manager && data && (
        <CapsForm
          key={`${data.settings.personalAgentCap}:${data.settings.managerDailySpawnCap}:${data.settings.sharedMessagesPerHour}`}
          settings={data.settings}
          busy={busy}
          onSave={(settings) => void run(() => api.saveSettings(settings))}
        />
      )}
      {error && <FormAlert>{error}</FormAlert>}
    </section>
  );
}

function CapsForm({
  settings,
  busy,
  onSave,
}: {
  settings: OfficeAgentsResponse["settings"];
  busy: boolean;
  onSave: (settings: OfficeAgentsResponse["settings"]) => void;
}) {
  const [personal, setPersonal] = useState(String(settings.personalAgentCap));
  const [spawns, setSpawns] = useState(String(settings.managerDailySpawnCap));
  const [messages, setMessages] = useState(String(settings.sharedMessagesPerHour));
  const valid =
    /^\d{1,3}$/.test(personal) && /^\d{1,3}$/.test(spawns) && /^[1-9]\d{0,3}$/.test(messages);
  return (
    <form
      className="rg-office-agent-caps"
      aria-label="Agent limits"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid)
          onSave({
            personalAgentCap: Number(personal),
            managerDailySpawnCap: Number(spawns),
            sharedMessagesPerHour: Number(messages),
          });
      }}
    >
      <label>
        <span className="rg-field__label">Personal agents per person</span>
        <input
          className="rg-input"
          inputMode="numeric"
          value={personal}
          onChange={(e) => setPersonal(e.currentTarget.value)}
        />
      </label>
      <label>
        <span className="rg-field__label">Henchmen a manager agent may spawn per day</span>
        <input
          className="rg-input"
          inputMode="numeric"
          value={spawns}
          onChange={(e) => setSpawns(e.currentTarget.value)}
        />
      </label>
      <label>
        <span className="rg-field__label">Messages a person may send a shared agent per hour</span>
        <input
          className="rg-input"
          inputMode="numeric"
          value={messages}
          onChange={(e) => setMessages(e.currentTarget.value)}
        />
      </label>
      <Button type="submit" size="sm" disabled={busy || !valid}>
        Save limits
      </Button>
    </form>
  );
}
