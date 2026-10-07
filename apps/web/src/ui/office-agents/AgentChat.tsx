/**
 * A person's conversation with an office agent (#271): history kept by the
 * office, a box to say something, and the reply when it arrives (the
 * conversation is polled while it is open). A reply shown here is read: the
 * office is told, and the "answer ready" bubble over the agent clears (#252).
 */
import { OFFICE_AGENT_LIMITS, type OfficeAgentConversation } from "@regulus/protocol";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { FormAlert } from "../auth/AuthCard.tsx";
import { Button } from "../components/Button.tsx";
import { describeOfficeAgentsError, type OfficeAgentsApi } from "./api.ts";

export const CHAT_POLL_MS = 2_000;

export function AgentChat({
  api,
  agentId,
  agentName,
  pollMs = CHAT_POLL_MS,
}: {
  api: OfficeAgentsApi;
  agentId: string;
  agentName: string;
  pollMs?: number;
}) {
  const [convo, setConvo] = useState<OfficeAgentConversation | null>(null);
  // Uncontrolled, like the office's other forms: read on send, cleared once it was accepted.
  const input = useRef<HTMLTextAreaElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();
  const log = useRef<HTMLOListElement>(null);

  // The newest reply the office was told we have read.
  const seenReply = useRef<string | null>(null);
  const load = useCallback(async () => {
    const res = await api.conversation(agentId);
    if (!res.ok) {
      setError(describeOfficeAgentsError(res));
      return;
    }
    setConvo(res.data);
    const reply = res.data.messages.findLast((m) => m.author === "agent");
    if (reply && reply.id !== seenReply.current) {
      seenReply.current = reply.id;
      void api.seen(agentId);
    }
  }, [api, agentId]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), pollMs);
    return () => clearInterval(timer);
  }, [load, pollMs]);

  const count = convo?.messages.length ?? 0;
  // Keep the newest line in view as the conversation grows.
  useEffect(() => {
    if (count > 0 && log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [count]);

  const send = async () => {
    const text = input.current?.value.trim() ?? "";
    if (!text || busy) return;
    setBusy(true);
    setError(null);
    const res = await api.send(agentId, text);
    if (res.ok && input.current) input.current.value = "";
    if (!res.ok) setError(describeOfficeAgentsError(res));
    await load();
    setBusy(false);
  };

  return (
    <div className="rg-office-agent-chat">
      <ol ref={log} className="rg-office-agent-chat__log" aria-label={`Chat with ${agentName}`}>
        {convo?.messages.length === 0 && (
          <li className="rg-muted">Nothing yet. Say something to {agentName}.</li>
        )}
        {convo?.messages.map((m) => (
          <li key={m.id} className={`rg-office-agent-chat__line is-${m.author}`}>
            <span className="rg-office-agent-chat__who">
              {m.author === "person" ? "You" : m.author === "agent" ? agentName : "Office"}
            </span>
            <span className="rg-office-agent-chat__text">{m.text}</span>
          </li>
        ))}
      </ol>
      <div role="status" aria-live="polite" className="rg-field__hint">
        {convo?.waiting ? `${agentName} is working on an answer…` : ""}
      </div>
      <form
        className="rg-office-agent-chat__form"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <label className="rg-sr-only" htmlFor={inputId}>
          Message to {agentName}
        </label>
        <textarea
          id={inputId}
          className="rg-input"
          rows={2}
          ref={input}
          maxLength={OFFICE_AGENT_LIMITS.messageMax}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <Button type="submit" variant="primary" size="sm" disabled={busy}>
          Send
        </Button>
      </form>
      {error && <FormAlert>{error}</FormAlert>}
    </div>
  );
}
