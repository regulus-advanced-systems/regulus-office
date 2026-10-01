/**
 * A henchman's changes window (#38; SPEC §10 M2, D10): opened from the henchman
 * panel. While it is open it polls the henchman's worktree every 2 s: a tree of
 * the files the branch changes against the merge-base with the default
 * branch, and the selected file's diff (images as before/after previews).
 *
 * Everyone who can see the operation watches read-only. The henchman's owner (D12;
 * `canWrite` from the server, which checks every write again) also picks
 * files and commits them with a message, discards a file's uncommitted
 * changes after confirming, and goes on to push and open the PR through the
 * existing PR dialog (#112). When the henchman touched a file after its human
 * looked, the server refuses and the window says which files to review.
 */
import type { ChangedFile, HenchmanState } from "@regulus/protocol";
import { useEffect, useId, useMemo, useState } from "react";
import { useOperationStore } from "../../state/operation.ts";
import { useAgentStore } from "../agent/agentStore.ts";
import { useAgentOverlay } from "../agent/useAgentOverlay.ts";
import { Button } from "../components/Button.tsx";
import { Modal } from "../components/Modal.tsx";
import { type ChangesApi, createChangesApi, describeChangesFailure } from "./api.ts";
import { useChangesWindow } from "./changesStore.ts";
import { DiffView } from "./DiffView.tsx";
import { FileTree } from "./FileTree.tsx";
import { useChangesPoll } from "./useChangesPoll.ts";
import "./changes.css";

const liveApi = createChangesApi();

export function ChangesWindowHost({ api = liveApi }: { api?: ChangesApi }) {
  const agentId = useChangesWindow((s) => s.agentId);
  const close = useChangesWindow((s) => s.closeChanges);
  const henchman = useOperationStore((s) => (agentId ? s.state?.henchmen[agentId] : undefined));
  useAgentOverlay(agentId !== null && henchman !== undefined, "agent-changes");
  // The henchman left (sent home, operation changed): close.
  useEffect(() => {
    if (agentId && !henchman) close();
  }, [agentId, henchman, close]);
  if (!agentId || !henchman) return null;
  return <ChangesWindow key={agentId} api={api} henchman={henchman} onClose={close} />;
}

interface Alert {
  text: string;
  files?: string[];
}

function ChangesWindow({
  api,
  henchman,
  onClose,
}: {
  api: ChangesApi;
  henchman: HenchmanState;
  onClose: () => void;
}) {
  const agentId = henchman.agentId;
  const { snapshot, error, refresh } = useChangesPoll(api, agentId);
  const [selected, setSelected] = useState<string | null>(null);
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(new Set());
  const [confirm, setConfirm] = useState<ChangedFile | null>(null);
  const [busy, setBusy] = useState(false);
  const [alert, setAlert] = useState<Alert | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const messageId = useId();

  const files = snapshot?.files ?? [];
  const current = files.find((f) => f.path === selected) ?? files[0] ?? null;
  const uncommitted = useMemo(() => files.filter((f) => f.uncommitted), [files]);
  const included = useMemo(
    () => new Set(uncommitted.filter((f) => !excluded.has(f.path)).map((f) => f.path)),
    [uncommitted, excluded],
  );
  const canWrite = snapshot?.canWrite ?? false;

  const toggle = (path: string) =>
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const fail = (res: Parameters<typeof describeChangesFailure>[0]) =>
    setAlert({ text: describeChangesFailure(res), files: res.files });

  const commit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const message = String(new FormData(form).get("message") ?? "").trim();
    const chosen = uncommitted.filter((f) => included.has(f.path));
    if (chosen.length === 0) return;
    if (!message) {
      setAlert({ text: "Write a commit message first." });
      return;
    }
    setBusy(true);
    setAlert(null);
    setNotice(null);
    const res = await api.commit(
      agentId,
      message,
      chosen.map((f) => ({ path: f.path, sig: f.sig })),
    );
    setBusy(false);
    if (res.ok) {
      form.reset();
      setNotice(
        `Committed ${res.data.files} file${res.data.files === 1 ? "" : "s"} as ${res.data.sha.slice(0, 7)}.`,
      );
    } else fail(res);
    refresh();
  };

  const discard = async (file: ChangedFile) => {
    setConfirm(null);
    setBusy(true);
    setAlert(null);
    setNotice(null);
    const res = await api.discard(agentId, { path: file.path, sig: file.sig });
    setBusy(false);
    if (res.ok) setNotice(`Discarded the changes to ${file.path}.`);
    else fail(res);
    refresh();
  };

  const pushAndOpenPr = () => {
    onClose();
    const agents = useAgentStore.getState();
    agents.openAgentPanel(agentId);
    agents.openDialog("pr");
  };

  const footer = (
    <>
      {canWrite && (
        <Button
          variant="primary"
          onClick={pushAndOpenPr}
          disabled={uncommitted.length > 0}
          title={
            uncommitted.length > 0 ? "Commit or discard the uncommitted files first" : undefined
          }
        >
          Push and open PR…
        </Button>
      )}
      <Button variant="secondary" onClick={onClose}>
        Done
      </Button>
    </>
  );

  return (
    <Modal
      open
      onClose={onClose}
      title={`Changes: ${henchman.taskTitle || henchman.model}`}
      width={1040}
      dismissOnBackdrop={false}
      footer={footer}
    >
      <div className="rg-changes" data-testid="changes-window">
        <div className="rg-changes__bar">
          {snapshot ? (
            <span>
              <code>{snapshot.branch ?? "detached HEAD"}</code> against{" "}
              <code>{snapshot.base.ref}</code>
              {" · "}
              {snapshot.ahead} commit{snapshot.ahead === 1 ? "" : "s"} · {uncommitted.length}{" "}
              uncommitted
              {snapshot.truncated ? " · list cut short" : ""}
            </span>
          ) : (
            <span>{error ? "" : "Looking at the henchman's worktree…"}</span>
          )}
          {snapshot && !canWrite && (
            <span className="rg-changes__readonly" data-testid="changes-readonly">
              Read only: only {henchman.ownerName || "its owner"} can commit or discard
            </span>
          )}
        </div>
        {error && (
          <div role="alert" className="rg-form-alert">
            {describeChangesFailure(error)}
          </div>
        )}
        <div className="rg-changes__main">
          <nav className="rg-changes__files" aria-label="Files">
            {snapshot && files.length === 0 ? (
              <p className="rg-field__hint">No changes yet.</p>
            ) : (
              <FileTree
                files={files}
                selected={current?.path ?? null}
                onSelect={setSelected}
                included={canWrite ? included : undefined}
                onToggleInclude={canWrite ? toggle : undefined}
                onDiscard={canWrite ? setConfirm : undefined}
              />
            )}
          </nav>
          <section
            className="rg-changes__view"
            aria-label={current ? `Diff of ${current.path}` : "Diff"}
          >
            {current ? (
              <>
                <h2 className="rg-changes__path">{current.path}</h2>
                <DiffView
                  key={current.path}
                  api={api}
                  agentId={agentId}
                  file={current}
                  head={snapshot?.head ?? null}
                />
              </>
            ) : (
              <p className="rg-field__hint">Pick a file to see its diff.</p>
            )}
          </section>
        </div>
        {confirm && (
          <div role="alertdialog" aria-label="Confirm discard" className="rg-changes-confirm">
            <p>
              Discard the uncommitted changes to <code>{confirm.path}</code>?
              {confirm.kind === "untracked" ? " The file will be deleted." : ""} This cannot be
              undone.
            </p>
            <div className="rg-agent-row">
              <Button size="sm" variant="secondary" onClick={() => setConfirm(null)}>
                Cancel
              </Button>
              <Button
                size="sm"
                variant="destructive"
                disabled={busy}
                onClick={() => void discard(confirm)}
              >
                Discard
              </Button>
            </div>
          </div>
        )}
        {alert && (
          <div role="alert" className="rg-form-alert" data-testid="changes-alert">
            {alert.text}
            {alert.files && alert.files.length > 0 && (
              <ul className="rg-changes-alert__files">
                {alert.files.map((f) => (
                  <li key={f}>
                    <code>{f}</code>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {notice && (
          <div role="status" className="rg-field__hint">
            {notice}
          </div>
        )}
        {canWrite && (
          <form className="rg-changes-commit" aria-label="Commit" onSubmit={(e) => void commit(e)}>
            <label className="rg-field__label" htmlFor={messageId}>
              Commit message
            </label>
            <textarea
              id={messageId}
              className="rg-input rg-agent-textarea"
              rows={2}
              maxLength={5000}
              name="message"
              placeholder="What these changes do"
            />
            <div className="rg-agent-row">
              <span className="rg-field__hint">
                {included.size} of {uncommitted.length} uncommitted file
                {uncommitted.length === 1 ? "" : "s"} selected
              </span>
              <Button
                type="submit"
                size="sm"
                variant="primary"
                disabled={busy || included.size === 0}
              >
                Commit
              </Button>
            </div>
          </form>
        )}
      </div>
    </Modal>
  );
}
