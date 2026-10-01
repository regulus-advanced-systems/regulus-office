/**
 * Archive and delete an operation (#150), for office owners and admins only
 * (operation managers don't see it; the server refuses them too).
 *
 * - Archive hides the operation and keeps everything; Settings → Operations restores it.
 * - Delete is permanent and needs the operation's name typed. While henchmen are on
 *   the operation the server refuses it with their list; "Send all home" sends
 *   them home (their branches are kept), then delete again. Nothing on
 *   GitHub is deleted.
 */
import type { OperationHenchmanInfo } from "@regulus/protocol";
import { useId, useState } from "react";
import { useOperationsStore } from "../../state/operations.ts";
import { canManageOffice, useSessionStore } from "../../state/session.ts";
import { FormAlert } from "../auth/AuthCard.tsx";
import { Button } from "../components/Button.tsx";
import { describeOperationError, type OperationsApi } from "./api.ts";

const STATUS_WORDS: Partial<Record<OperationHenchmanInfo["status"], string>> = {
  waiting_permission: "waiting for approval",
  waiting_input: "waiting for input",
};

function HenchmanList({ henchmen }: { henchmen: readonly OperationHenchmanInfo[] }) {
  return (
    <ul className="rg-danger-zone__henchmen" aria-label="Henchmen in this operation">
      {henchmen.map((r) => (
        <li key={r.agentId}>
          <strong>{r.taskTitle || "Henchman"}</strong> ({r.ownerName},{" "}
          {STATUS_WORDS[r.status] ?? r.status})
        </li>
      ))}
    </ul>
  );
}

/** Type the name, delete; shows the henchmen in the way and a "Send all home" helper. */
export function DeleteOperationForm({
  operation,
  api,
  onDeleted,
}: {
  operation: { operationId: string; name: string };
  api: OperationsApi;
  onDeleted: () => void | Promise<void>;
}) {
  const inputId = useId();
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [henchmen, setHenchmen] = useState<OperationHenchmanInfo[]>([]);
  const matches = typed.trim() === operation.name.trim();

  const remove = async () => {
    setBusy(true);
    setError(null);
    setStatus("");
    const res = await api.remove(operation.operationId, typed);
    setBusy(false);
    if (res.ok) {
      setHenchmen([]);
      await onDeleted();
      return;
    }
    setHenchmen(res.henchmen ?? []);
    setError(describeOperationError(res));
  };

  const sendAllHome = async () => {
    setBusy(true);
    setError(null);
    const res = await api.sendHome(operation.operationId);
    setBusy(false);
    if (!res.ok) return setError(describeOperationError(res));
    const { sentHome, failed } = res.data;
    setHenchmen((left) => left.filter((r) => failed.some((f) => f.agentId === r.agentId)));
    const n = `${sentHome} ${sentHome === 1 ? "henchman" : "henchmen"}`;
    if (failed.length > 0) {
      setError(`Sent ${n} home; ${failed.length} could not be: ${failed[0]?.reason ?? ""}`);
    } else {
      setStatus(`Sent ${n} home. You can delete the operation now.`);
    }
  };

  return (
    <div className="rg-danger-zone__delete">
      <p>
        This permanently deletes <strong>{operation.name}</strong>: its desks, members, henchman
        history, the office's copy of its repos and everyone's clones and worktrees on it. Unpushed
        work in them is lost. Nothing on GitHub is deleted.
      </p>
      <label className="rg-field__label" htmlFor={inputId}>
        Type the operation name to confirm
      </label>
      <div className="rg-danger-zone__row">
        <input
          id={inputId}
          className="rg-input"
          autoComplete="off"
          value={typed}
          placeholder={operation.name}
          onChange={(e) => setTyped(e.currentTarget.value)}
        />
        <Button
          variant="destructive"
          size="sm"
          disabled={!matches || busy}
          onClick={() => void remove()}
        >
          Delete operation
        </Button>
      </div>
      {henchmen.length > 0 && (
        <>
          <HenchmanList henchmen={henchmen} />
          <div>
            <Button
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={() => void sendAllHome()}
            >
              Send all home
            </Button>
          </div>
          <div className="rg-field__hint">
            Each henchman is stopped and sent home; its branch is kept.
          </div>
        </>
      )}
      {error && <FormAlert>{error}</FormAlert>}
      <div role="status" aria-live="polite" className="rg-operation-settings__status">
        {status}
      </div>
    </div>
  );
}

/** The "Danger zone" section of Operation settings. */
export function OperationDangerZone({
  operation,
  api,
}: {
  operation: { operationId: string; name: string };
  api: OperationsApi;
}) {
  const allowed = useSessionStore((s) => canManageOffice(s.user?.role));
  const refreshOperations = useOperationsStore((s) => s.refresh);
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!allowed) return null;

  const archive = async () => {
    setBusy(true);
    setError(null);
    const res = await api.archive(operation.operationId);
    setBusy(false);
    if (!res.ok) return setError(describeOperationError(res));
    // The operation leaves the list, which closes this dialog.
    await refreshOperations(api);
  };

  return (
    <section className="rg-danger-zone" aria-label="Danger zone">
      <h2 className="rg-operation-settings__heading">Danger zone</h2>
      <div className="rg-danger-zone__row">
        <Button variant="secondary" size="sm" disabled={busy} onClick={() => void archive()}>
          Archive operation
        </Button>
        <span className="rg-field__hint">
          Takes its room out of the compound. Everything is kept; restore it from Settings →
          Operations.
        </span>
      </div>
      {error && <FormAlert>{error}</FormAlert>}
      <div className="rg-danger-zone__row">
        <Button
          variant="destructive"
          size="sm"
          aria-expanded={deleting}
          onClick={() => setDeleting((d) => !d)}
        >
          Delete operation…
        </Button>
      </div>
      {deleting && (
        <DeleteOperationForm
          operation={operation}
          api={api}
          onDeleted={() => refreshOperations(api)}
        />
      )}
    </section>
  );
}
