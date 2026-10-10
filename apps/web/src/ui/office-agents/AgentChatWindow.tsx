/**
 * An office agent's chat as a window in the world (#252): opened by a click
 * or `E` on the agent, or on its bubble. The conversation is the one from
 * Settings → Agents (`AgentChat`), with the question it is waiting on at the
 * top, and for a personal agent its owner's Dismiss / Recall.
 *
 * It is a `Modal`, so it counts as an open window (state/windows.ts): the
 * first-person view frees the cursor and stands still while it is up (#282).
 * The host also keeps "what my agents want from me" current
 * (`useAgentAttention`): read once, again whenever the office says it
 * changed, and now and then in case a nudge was missed.
 */
import {
  type HumanRequest,
  OFFICE_AGENT_ATTENTION_MESSAGE,
  type OfficeAgentBody,
} from "@regulus/protocol";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getOfficeClient } from "../../net/index.ts";
import { useBuildingStore } from "../../state/building.ts";
import {
  bodyCaption,
  canChatWith,
  isBoardHelper,
  isOwnBody,
  useAgentAttention,
  useAgentChatWindow,
  type Viewer,
} from "../../state/officeAgents.ts";
import { useSessionStore } from "../../state/session.ts";
import { setConversationOpener } from "../agent/bubbleTarget.ts";
import { FormAlert } from "../auth/AuthCard.tsx";
import { Button } from "../components/Button.tsx";
import { Modal } from "../components/Modal.tsx";
import { AgentChat } from "./AgentChat.tsx";
import { createOfficeAgentsApi, describeOfficeAgentsError, type OfficeAgentsApi } from "./api.ts";
import { openOfficeAgentChat } from "./chatRequest.ts";
import { KioskBrief } from "./KioskBrief.tsx";
import { KioskProposals } from "./KioskProposals.tsx";
import { PendingRequests } from "./PendingRequests.tsx";

/** In case a nudge from the office was missed (a reconnect), ms. */
export const ATTENTION_REFRESH_MS = 30_000;

type Nudges = (type: string, listener: () => void) => () => void;

/** Keep `useAgentAttention` current while mounted. */
export function useAttentionSync(api: OfficeAgentsApi, onNudge: Nudges, userId: string | null) {
  const load = useCallback(async () => {
    const res = await api.attention();
    if (res.ok) useAgentAttention.getState().set(res.data.agents);
  }, [api]);
  useEffect(() => {
    if (!userId) return;
    void load();
    const off = onNudge(OFFICE_AGENT_ATTENTION_MESSAGE, () => void load());
    const timer = setInterval(() => void load(), ATTENTION_REFRESH_MS);
    return () => {
      off();
      clearInterval(timer);
      useAgentAttention.getState().set([]);
    };
  }, [load, onNudge, userId]);
  return load;
}

function ChatWindow({
  api,
  body,
  viewer,
  onClose,
  onChanged,
}: {
  api: OfficeAgentsApi;
  body: OfficeAgentBody;
  viewer: Viewer;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requests, setRequests] = useState<HumanRequest[]>([]);
  const asking = useAgentAttention((s) => s.byAgent[body.agentId]?.question);
  const mine = isOwnBody(body, viewer);

  // The question it is waiting on, to answer right here.
  useEffect(() => {
    let live = true;
    if (asking === undefined) {
      setRequests([]);
      return;
    }
    void api.requests().then((res) => {
      if (live && res.ok) setRequests(res.data.requests.filter((r) => r.agentId === body.agentId));
    });
    return () => {
      live = false;
    };
  }, [api, asking, body.agentId]);

  const run = async (fn: () => Promise<{ ok: boolean }>) => {
    setBusy(true);
    setError(null);
    const res = await fn();
    if (!res.ok) setError(describeOfficeAgentsError(res as never));
    setBusy(false);
    onChanged();
  };

  return (
    <Modal
      open
      onClose={onClose}
      width={560}
      title={body.name}
      footer={
        <>
          {mine && (
            <Button
              disabled={busy}
              onClick={() =>
                void run(() =>
                  body.dismissed ? api.recall(body.agentId) : api.dismiss(body.agentId),
                )
              }
              title={
                body.dismissed
                  ? "It comes back to your side and follows you again."
                  : "It stops following you and roams the lair until you recall it."
              }
            >
              {body.dismissed ? "Recall to my side" : "Dismiss"}
            </Button>
          )}
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </>
      }
    >
      <div className="rg-office-agent-window" data-testid="agent-chat-window">
        <p className="rg-field__hint">
          {bodyCaption(body, viewer)}
          {mine
            ? body.dismissed
              ? ", roaming the lair."
              : ", at your side."
            : isBoardHelper(body)
              ? `, ${body.doing || "at its board"}.`
              : ", shared by the office."}
        </p>
        {isBoardHelper(body) && <KioskBrief api={api} agentId={body.agentId} />}
        {isBoardHelper(body) && <KioskProposals api={api} agentId={body.agentId} />}
        <PendingRequests
          requests={requests}
          busy={busy}
          onAnswer={(id, answer) => void run(() => api.answer(id, { answer }))}
        />
        <AgentChat api={api} agentId={body.agentId} agentName={body.name} />
        {error && <FormAlert>{error}</FormAlert>}
      </div>
    </Modal>
  );
}

export function AgentChatWindowHost({ api: given }: { api?: OfficeAgentsApi }) {
  const api = useMemo(() => given ?? createOfficeAgentsApi(), [given]);
  const user = useSessionStore((s) => s.user);
  const viewer = useMemo<Viewer | null>(
    () => (user ? { id: user.id, role: user.role } : null),
    [user],
  );
  const agentId = useAgentChatWindow((s) => s.agentId);
  const close = useAgentChatWindow((s) => s.close);
  const known = useAgentChatWindow((s) => s.known);
  const live = useBuildingStore((s) => (agentId ? s.state?.officeAgents?.[agentId] : undefined));
  // Its body can go out of this viewer's state while the window is open: the office PM walks
  // its round into a room closed to them (#60). The conversation stays, with what was last seen.
  const seen = useRef<OfficeAgentBody | null>(null);
  if (live) seen.current = live;
  const body = agentId
    ? (live ?? (seen.current?.agentId === agentId ? seen.current : null) ?? known ?? undefined)
    : undefined;
  const onNudge = useCallback<Nudges>(
    (type, listener) => getOfficeClient().onBuildingMessage(type, listener),
    [],
  );
  const reload = useAttentionSync(api, onNudge, viewer?.id ?? null);

  // A click on an office agent's bubble (or a "needs you" notification) opens this window when
  // the agent is in the world for us; Settings → Agents stays the way in otherwise.
  useEffect(
    () =>
      setConversationOpener((id) => {
        const there = useBuildingStore.getState().state?.officeAgents?.[id];
        const me = useSessionStore.getState().user;
        if (there && me && canChatWith(there, { id: me.id, role: me.role })) {
          useAgentChatWindow.getState().open(id);
        } else openOfficeAgentChat(id);
      }),
    [],
  );

  // It is not ours to talk to: nothing to show.
  useEffect(() => {
    if (agentId && (!body || !canChatWith(body, viewer))) close();
  }, [agentId, body, viewer, close]);
  // Out of sight is not gone, but a deleted agent is: ask the office which it is.
  const gone = agentId !== null && !live;
  useEffect(() => {
    if (!gone || !agentId) return;
    let current = true;
    void api.list().then((res) => {
      if (current && res.ok && !res.data.agents.some((a) => a.id === agentId)) close();
    });
    return () => {
      current = false;
    };
  }, [gone, agentId, api, close]);

  if (!agentId || !body || !viewer || !canChatWith(body, viewer)) return null;
  return (
    <ChatWindow
      key={agentId}
      api={api}
      body={body}
      viewer={viewer}
      onClose={() => {
        close();
        void reload();
      }}
      onChanged={() => void reload()}
    />
  );
}
