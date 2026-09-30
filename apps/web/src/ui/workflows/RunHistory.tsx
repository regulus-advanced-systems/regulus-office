/**
 * Run history (#155): every run with its trigger, target, status, robot,
 * duration, tokens and links to what it posted; a run opens its log.
 */
import type { WorkflowRunDetail, WorkflowRunView } from "@regulus/protocol";
import { useCallback, useEffect, useState } from "react";
import { FormAlert } from "../auth/AuthCard.tsx";
import { Button } from "../components/Button.tsx";
import { describeWorkflowError, type WorkflowsApi } from "./api.ts";
import { formatDuration, formatTokens, STATUS_LABELS, targetLabel } from "./workflowForm.ts";

const LINK_LABELS = { review: "review", comment: "comment", labels: "labels", check_run: "check" };

export function RunHistory({
  api,
  floorId,
  canEdit,
  pollMs = 5_000,
  now = Date.now,
}: {
  api: WorkflowsApi;
  floorId: string;
  canEdit: boolean;
  pollMs?: number;
  now?: () => number;
}) {
  const [runs, setRuns] = useState<WorkflowRunView[] | null>(null);
  const [open, setOpen] = useState<WorkflowRunDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const r = await api.runs(floorId);
    if (r.ok) setRuns(r.data.runs);
    else setError(describeWorkflowError(r));
  }, [api, floorId]);

  useEffect(() => {
    void reload();
    if (pollMs <= 0) return;
    const timer = setInterval(() => void reload(), pollMs);
    return () => clearInterval(timer);
  }, [reload, pollMs]);

  const show = async (id: string) => {
    const r = await api.run(id);
    if (r.ok) setOpen(r.data);
    else setError(describeWorkflowError(r));
  };
  const cancel = async (id: string) => {
    const r = await api.cancel(id);
    if (!r.ok) setError(describeWorkflowError(r));
    await reload();
  };

  if (runs === null)
    return error ? <FormAlert>{error}</FormAlert> : <p className="rg-muted">Loading runs…</p>;
  return (
    <div className="rg-workflows__runs" data-testid="workflow-runs">
      {error && <FormAlert>{error}</FormAlert>}
      {runs.length === 0 ? (
        <p className="rg-muted">No runs yet.</p>
      ) : (
        <table className="rg-workflows__table">
          <thead>
            <tr>
              <th>Status</th>
              <th>Workflow</th>
              <th>Trigger</th>
              <th>Target</th>
              <th>Robot</th>
              <th>Time</th>
              <th>Tokens</th>
              <th>Posted</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.id}>
                <td>
                  <button
                    type="button"
                    className="rg-workflows__linkish"
                    onClick={() => void show(r.id)}
                  >
                    {STATUS_LABELS[r.status]}
                  </button>
                  {r.reason && <div className="rg-field__hint">{r.reason}</div>}
                </td>
                <td>{r.workflowName}</td>
                <td>{r.trigger}</td>
                <td>
                  {r.target?.url ? (
                    <a href={r.target.url} target="_blank" rel="noreferrer noopener">
                      {targetLabel(r)}
                    </a>
                  ) : (
                    targetLabel(r)
                  )}
                </td>
                <td>
                  {r.robot}
                  <div className="rg-field__hint">{r.model ?? r.provider}</div>
                </td>
                <td>{formatDuration(r, now())}</td>
                <td>{formatTokens(r.inputTokens + r.outputTokens)}</td>
                <td>
                  {r.links
                    .filter((l) => l.url)
                    .map((l) => (
                      <a
                        key={l.url}
                        href={l.url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="rg-workflows__link"
                      >
                        {LINK_LABELS[l.kind]}
                      </a>
                    ))}
                  {canEdit && (r.status === "queued" || r.status === "running") && (
                    <Button size="sm" variant="ghost" onClick={() => void cancel(r.id)}>
                      Cancel
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {open && (
        <section className="rg-workflows__log" aria-label="Run log">
          <h3 className="rg-workflows__heading">
            {open.workflowName}: {STATUS_LABELS[open.status]} ({open.trigger})
          </h3>
          <pre className="rg-workflows__pre">{open.log.join("\n") || "(no log)"}</pre>
          {open.summary && (
            <details>
              <summary>What was posted</summary>
              <pre className="rg-workflows__pre">{open.summary}</pre>
            </details>
          )}
          <Button size="sm" variant="ghost" onClick={() => setOpen(null)}>
            Close log
          </Button>
        </section>
      )}
    </div>
  );
}
