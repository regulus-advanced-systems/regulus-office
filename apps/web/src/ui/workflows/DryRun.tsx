/** Dry run (#155): try the workflow as edited against a recent GitHub event; nothing is posted. */
import type { WorkflowDryRunResult, WorkflowEventView, WorkflowSpec } from "@regulus/protocol";
import { useEffect, useId, useState } from "react";
import { FormAlert } from "../auth/AuthCard.tsx";
import { Button } from "../components/Button.tsx";
import { describeWorkflowError, type WorkflowsApi } from "./api.ts";

export function DryRun({
  api,
  operationId,
  workflowId,
  spec,
}: {
  api: WorkflowsApi;
  operationId: string;
  workflowId: string;
  spec: WorkflowSpec;
}) {
  const id = useId();
  const [events, setEvents] = useState<WorkflowEventView[] | null>(null);
  const [eventId, setEventId] = useState("");
  const [result, setResult] = useState<WorkflowDryRunResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void api.events(operationId).then((r) => {
      if (!live) return;
      if (r.ok) {
        setEvents(r.data.events);
        setEventId(r.data.events[0]?.id ?? "");
      } else setError(describeWorkflowError(r));
    });
    return () => {
      live = false;
    };
  }, [api, operationId]);

  const run = async () => {
    setBusy(true);
    setError(null);
    const r = await api.dryRun(workflowId, eventId, spec);
    setBusy(false);
    if (r.ok) setResult(r.data);
    else setError(describeWorkflowError(r));
  };

  return (
    <section className="rg-workflows__dry" aria-label="Dry run">
      <h3 className="rg-workflows__heading">Dry run</h3>
      {events === null ? (
        !error && <p className="rg-muted">Loading recent events…</p>
      ) : events.length === 0 ? (
        <p className="rg-muted">
          No GitHub events for this operation yet. They appear here as they arrive.
        </p>
      ) : (
        <div className="rg-workflows__row">
          <label className="rg-field__label" htmlFor={id}>
            Event
          </label>
          <select
            id={id}
            className="rg-input"
            value={eventId}
            onChange={(e) => setEventId(e.currentTarget.value)}
          >
            {events.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}: {e.summary}
              </option>
            ))}
          </select>
          <Button size="sm" disabled={busy || !eventId} onClick={() => void run()}>
            Dry run
          </Button>
        </div>
      )}
      {error && <FormAlert>{error}</FormAlert>}
      {result && (
        <div className="rg-workflows__result" data-testid="dry-run-result">
          <p>
            <strong>{result.matched ? "Would run." : "Would not run."}</strong>{" "}
            {result.reasons.join("; ")}
          </p>
          <p>Would post: {result.actions.join("; ")}</p>
          <ul className="rg-workflows__safety">
            {result.safety.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
          {result.prompt && (
            <details>
              <summary>Prompt</summary>
              <pre className="rg-workflows__pre">{result.prompt}</pre>
            </details>
          )}
        </div>
      )}
    </section>
  );
}
