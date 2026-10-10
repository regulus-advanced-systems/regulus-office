/**
 * What a board helper proposes to queue for this person (#56). A helper
 * cannot queue anything itself: what it read on the board is other people's
 * text. Each proposal is shown in full (what kind of task, which issue or pull
 * request, the prompt word for word, what would run it), and it is queued only
 * when the person presses Confirm, as a request from their own browser.
 *
 * Polled while the chat is open, like the conversation beside it.
 */
import type { TaskProposal } from "@regulus/protocol";
import { useCallback, useEffect, useState } from "react";
import { FormAlert } from "../auth/AuthCard.tsx";
import { Button } from "../components/Button.tsx";
import { CHAT_POLL_MS } from "./AgentChat.tsx";
import { describeOfficeAgentsError, type OfficeAgentsApi } from "./api.ts";

const KIND_WORDS = { issue: "Work on issue", pr: "Work on pull request", freeform: "A task" };

/** "in 12 min", "in under a minute". */
function expiresIn(proposal: TaskProposal, now: number): string {
  const minutes = Math.floor((proposal.expiresAt - now) / 60_000);
  return minutes < 1 ? "in under a minute" : `in ${minutes} min`;
}

export function KioskProposals({
  api,
  agentId,
  pollMs = CHAT_POLL_MS,
  now = Date.now,
}: {
  api: OfficeAgentsApi;
  agentId: string;
  pollMs?: number;
  now?: () => number;
}) {
  const [proposals, setProposals] = useState<TaskProposal[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [queued, setQueued] = useState(false);

  const load = useCallback(async () => {
    const res = await api.proposals(agentId);
    if (res.ok) setProposals(res.data.proposals);
  }, [api, agentId]);
  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), pollMs);
    return () => clearInterval(timer);
  }, [load, pollMs]);

  const act = async (proposal: TaskProposal, action: "confirm" | "dismiss") => {
    setBusy(true);
    setError(null);
    const res =
      action === "confirm"
        ? await api.confirmProposal(agentId, proposal.id)
        : await api.dismissProposal(agentId, proposal.id);
    if (!res.ok) setError(describeOfficeAgentsError(res));
    else setQueued(action === "confirm");
    setBusy(false);
    await load();
  };

  return (
    <>
      {proposals.map((p) => {
        const { task } = p;
        const target =
          task.kind === "freeform"
            ? (task.title ?? "")
            : `#${task.refNumber}${p.cardTitle ? ` ${p.cardTitle}` : ""}`;
        return (
          <section
            key={p.id}
            className="rg-kiosk-proposal"
            aria-label={`${p.agentName} proposes a task`}
            data-testid="kiosk-proposal"
          >
            <strong>{p.agentName} wants to queue this for you. Nothing is queued yet.</strong>
            <dl className="rg-kiosk-proposal__facts">
              <dt>Task</dt>
              <dd>
                {KIND_WORDS[task.kind]} {target}
              </dd>
              <dt>Room</dt>
              <dd>
                {p.operationName} ({p.repo})
              </dd>
              <dt>Runs on</dt>
              <dd>
                {task.provider}, model {task.model}
                {task.effort ? `, effort ${task.effort}` : ""}, on the office's key, as your
                henchman
              </dd>
            </dl>
            {task.prompt ? (
              <>
                <div className="rg-field__hint">The henchman would be told exactly this:</div>
                <pre className="rg-kiosk-proposal__prompt">{task.prompt}</pre>
              </>
            ) : (
              <div className="rg-field__hint">
                The henchman would get the office's standard instructions for this{" "}
                {task.kind === "pr" ? "pull request" : "issue"}, nothing written by the helper.
              </div>
            )}
            <div className="rg-office-agent__actions">
              <Button
                variant="primary"
                size="sm"
                disabled={busy}
                onClick={() => void act(p, "confirm")}
              >
                Confirm and queue
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => void act(p, "dismiss")}
              >
                Do not queue
              </Button>
              <span className="rg-field__hint">Expires {expiresIn(p, now())}.</span>
            </div>
          </section>
        );
      })}
      {queued && proposals.length === 0 && (
        <p className="rg-field__hint" role="status">
          Queued. It is on the room's task queue as yours.
        </p>
      )}
      {error && <FormAlert>{error}</FormAlert>}
    </>
  );
}
