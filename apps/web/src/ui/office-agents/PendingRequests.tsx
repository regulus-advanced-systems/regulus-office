/**
 * Questions office agents asked the viewer (#271): pick a suggested answer
 * or write one. The bubble over the agent (#256) will show the same records.
 */
import { type HumanRequest, OFFICE_AGENT_LIMITS } from "@regulus/protocol";
import { useState } from "react";
import { Button } from "../components/Button.tsx";

export function PendingRequests({
  requests,
  busy,
  onAnswer,
}: {
  requests: readonly HumanRequest[];
  busy: boolean;
  onAnswer: (requestId: string, answer: string) => void;
}) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  if (requests.length === 0) return null;
  return (
    <ul className="rg-office-agent-requests" aria-label="Questions for you">
      {requests.map((r) => {
        const draft = drafts[r.id] ?? "";
        return (
          <li key={r.id} className="rg-office-agent-request">
            <div>
              <strong>{r.agentName}</strong> asks: {r.question}
            </div>
            <div className="rg-office-agent__actions">
              {r.options.map((option) => (
                <Button
                  key={option}
                  size="sm"
                  disabled={busy}
                  onClick={() => onAnswer(r.id, option)}
                >
                  {option}
                </Button>
              ))}
            </div>
            <form
              className="rg-office-agent-chat__form"
              onSubmit={(e) => {
                e.preventDefault();
                if (draft.trim()) onAnswer(r.id, draft.trim());
              }}
            >
              <input
                className="rg-input"
                aria-label={`Answer ${r.agentName}`}
                value={draft}
                maxLength={OFFICE_AGENT_LIMITS.answerMax}
                placeholder="Your answer"
                onChange={(e) => setDrafts({ ...drafts, [r.id]: e.currentTarget.value })}
              />
              <Button type="submit" variant="primary" size="sm" disabled={busy || !draft.trim()}>
                Answer
              </Button>
            </form>
          </li>
        );
      })}
    </ul>
  );
}
