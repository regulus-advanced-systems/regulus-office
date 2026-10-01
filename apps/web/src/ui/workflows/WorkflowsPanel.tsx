/**
 * The operation's GitHub workflows (#155): the list with enable/disable, the
 * editor with a dry run, and the run history. Everyone on the operation sees the
 * workflows and their runs; office owners/admins and operation managers edit.
 * Opened from the top bar ("Workflows") and from Operation settings.
 */
import type { WorkflowListResponse, WorkflowSpec, WorkflowView } from "@regulus/protocol";
import { useCallback, useEffect, useState } from "react";
import { useUiStore } from "../../state/ui.ts";
import { FormAlert } from "../auth/AuthCard.tsx";
import type { ApiResult } from "../auth/api.ts";
import { Button } from "../components/Button.tsx";
import { Modal } from "../components/Modal.tsx";
import { Switch } from "../components/Switch.tsx";
import { createWorkflowsApi, describeWorkflowError, type WorkflowsApi } from "./api.ts";
import { DryRun } from "./DryRun.tsx";
import { RunHistory } from "./RunHistory.tsx";
import { WorkflowEditor } from "./WorkflowEditor.tsx";
import {
  actionsSummary,
  cloneSpec,
  formatTokens,
  MISSING_HINTS,
  newWorkflow,
  operationIdFromWorkflowsOverlay,
  triggerSummary,
  workflowsOverlay,
} from "./workflowForm.ts";
import "./workflows.css";

const defaultApi = createWorkflowsApi();

export function openWorkflowsPanel(operationId: string): void {
  useUiStore.getState().openOverlay(workflowsOverlay(operationId));
}

function specOf(w: WorkflowView): WorkflowSpec {
  const {
    id: _i,
    operationId: _f,
    createdBy: _c,
    createdAt: _a,
    updatedAt: _u,
    today: _t,
    ...spec
  } = w;
  return cloneSpec(spec as WorkflowSpec);
}

type Editing = { id: string | null; spec: WorkflowSpec };

export function WorkflowsBody({
  operationId,
  api,
  pollMs,
}: {
  operationId: string;
  api: WorkflowsApi;
  pollMs?: number;
}) {
  const [data, setData] = useState<WorkflowListResponse | null>(null);
  const [tab, setTab] = useState<"workflows" | "runs">("workflows");
  const [editing, setEditing] = useState<Editing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    const r = await api.list(operationId);
    if (r.ok) setData(r.data);
    else setError(describeWorkflowError(r));
  }, [api, operationId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const act = async (fn: () => Promise<ApiResult<unknown>>, done: string) => {
    setBusy(true);
    setError(null);
    setStatus("");
    const r = await fn();
    setBusy(false);
    if (!r.ok) {
      setError(describeWorkflowError(r));
      return false;
    }
    setStatus(done);
    await reload();
    return true;
  };

  const save = async () => {
    if (!editing) return;
    const { id, spec } = editing;
    const ok = await act(
      () => (id ? api.update(id, spec) : api.create({ operationId, ...spec })),
      `Saved "${spec.name}".`,
    );
    if (ok) setEditing(null);
  };
  const toggle = (w: WorkflowView, enabled: boolean) =>
    void act(
      () => api.update(w.id, { ...specOf(w), enabled }),
      `${w.name} is ${enabled ? "on" : "off"}.`,
    );
  const remove = (w: WorkflowView) => void act(() => api.remove(w.id), `Deleted "${w.name}".`);

  if (!data) return error ? <FormAlert>{error}</FormAlert> : <p className="rg-muted">Loading…</p>;
  const canEdit = data.canEdit;

  return (
    <div className="rg-workflows" data-testid="workflows-panel">
      <div className="rg-workflows__tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "workflows"}
          onClick={() => setTab("workflows")}
        >
          Workflows
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "runs"}
          onClick={() => setTab("runs")}
        >
          Runs
        </button>
      </div>
      {data.missing.map((m) => (
        <FormAlert key={m} kind="info">
          {MISSING_HINTS[m] ?? m}
        </FormAlert>
      ))}
      {tab === "runs" ? (
        <RunHistory api={api} operationId={operationId} canEdit={canEdit} pollMs={pollMs} />
      ) : editing ? (
        <>
          <WorkflowEditor
            spec={editing.spec}
            canApprove={data.canApprove}
            onChange={(spec) => setEditing({ ...editing, spec })}
          />
          <div className="rg-workflows__row">
            <Button variant="primary" disabled={busy} onClick={() => void save()}>
              {editing.id ? "Save" : "Create workflow"}
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => setEditing(null)}>
              Cancel
            </Button>
          </div>
          {editing.id ? (
            <DryRun
              api={api}
              operationId={operationId}
              workflowId={editing.id}
              spec={editing.spec}
            />
          ) : (
            <p className="rg-field__hint">
              Save the workflow (it can stay off) to dry-run it against a past event.
            </p>
          )}
        </>
      ) : (
        <>
          <p className="rg-field__hint">
            Workflows run a review henchman when something happens on GitHub and post what it finds
            as the office's GitHub App. Every action starts off.
          </p>
          {data.workflows.length === 0 && (
            <p className="rg-muted">No workflows in this operation yet.</p>
          )}
          <ul className="rg-workflows__list">
            {data.workflows.map((w) => (
              <li key={w.id} className="rg-workflows__item">
                <div className="rg-workflows__item-main">
                  <strong>{w.name}</strong>
                  <div className="rg-field__hint">
                    {triggerSummary(w.trigger)} · {actionsSummary(w)} · today {w.today.runs} runs,{" "}
                    {formatTokens(w.today.tokens)} tokens
                  </div>
                </div>
                {canEdit ? (
                  <>
                    <Switch
                      checked={w.enabled}
                      disabled={busy}
                      onChange={(on) => toggle(w, on)}
                      label={w.enabled ? "On" : "Off"}
                    />
                    <Button
                      size="sm"
                      disabled={busy}
                      onClick={() => setEditing({ id: w.id, spec: specOf(w) })}
                    >
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={busy}
                      onClick={() => remove(w)}
                    >
                      Delete
                    </Button>
                  </>
                ) : (
                  <span className="rg-muted">{w.enabled ? "On" : "Off"}</span>
                )}
              </li>
            ))}
          </ul>
          {canEdit && (
            <Button
              variant="primary"
              size="sm"
              onClick={() => setEditing({ id: null, spec: newWorkflow() })}
            >
              New workflow
            </Button>
          )}
        </>
      )}
      {error && <FormAlert>{error}</FormAlert>}
      <div role="status" aria-live="polite" className="rg-workflows__status">
        {status}
      </div>
    </div>
  );
}

/** Mounted in the HUD; renders while the `workflows:<operationId>` overlay is open. */
export function WorkflowsPanelHost({ api = defaultApi }: { api?: WorkflowsApi }) {
  const overlay = useUiStore((s) => s.overlay);
  const close = useUiStore((s) => s.closeOverlay);
  const operationId = operationIdFromWorkflowsOverlay(overlay);
  if (!operationId) return null;
  const done = () => close(overlay ?? undefined);
  return (
    <Modal
      open
      onClose={done}
      title="GitHub workflows"
      width={880}
      dismissOnBackdrop={false}
      footer={
        <Button variant="primary" onClick={done}>
          Done
        </Button>
      }
    >
      <WorkflowsBody key={operationId} operationId={operationId} api={api} />
    </Modal>
  );
}
