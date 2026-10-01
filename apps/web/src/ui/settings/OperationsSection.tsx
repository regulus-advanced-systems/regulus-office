/**
 * "Operations" in Settings, for office owners and admins (#150): archived operations,
 * each with Restore (back in the compound as it was) and Delete (permanent,
 * the same typed-name confirmation as in Operation settings).
 */
import type { OperationInfo } from "@regulus/protocol";
import { useCallback, useEffect, useState } from "react";
import { useOperationsStore } from "../../state/operations.ts";
import { canManageOffice, useSessionStore } from "../../state/session.ts";
import { FormAlert } from "../auth/AuthCard.tsx";
import { Button } from "../components/Button.tsx";
import {
  createOperationsApi,
  describeOperationError,
  type OperationsApi,
} from "../operations/api.ts";
import { DeleteOperationForm } from "../operations/OperationDangerZone.tsx";
import "../operations/operations.css";

const defaultApi = createOperationsApi();

function archivedOn(at: number | null): string {
  return at ? new Date(at).toLocaleDateString() : "";
}

export function OperationsSection({ api = defaultApi }: { api?: OperationsApi }) {
  const allowed = useSessionStore((s) => canManageOffice(s.user?.role));
  const refreshOperations = useOperationsStore((s) => s.refresh);
  const [archived, setArchived] = useState<OperationInfo[] | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");

  const load = useCallback(async () => {
    const res = await api.archived();
    if (res.ok) setArchived(res.data.operations);
    else setError(describeOperationError(res));
  }, [api]);

  useEffect(() => {
    if (allowed) void load();
  }, [allowed, load]);

  if (!allowed) return null;

  const restore = async (operation: OperationInfo) => {
    setBusy(true);
    setError(null);
    setStatus("");
    const res = await api.restore(operation.operationId);
    setBusy(false);
    if (!res.ok) return setError(describeOperationError(res));
    setStatus(`${operation.name} is back in the compound.`);
    await Promise.all([load(), refreshOperations(api)]);
  };

  const deleted = async (operation: OperationInfo) => {
    setDeleting(null);
    setStatus(`${operation.name} was deleted.`);
    await load();
  };

  return (
    <section className="rg-settings__group" aria-label="Operations">
      <h3 className="rg-settings__heading">Archived operations</h3>
      <div className="rg-field__hint">
        Archived operations leave the compound; their data and clones are kept.
      </div>
      {archived === null ? (
        !error && <p className="rg-muted">Loading…</p>
      ) : archived.length === 0 ? (
        <p className="rg-muted">No archived operations.</p>
      ) : (
        <ul className="rg-list" aria-label="Archived operations">
          {archived.map((f) => (
            <li key={f.operationId} className="rg-archived-operation">
              <div className="rg-danger-zone__row">
                <span className="rg-settings__grow">
                  <strong>{f.name}</strong>{" "}
                  <span className="rg-muted">archived {archivedOn(f.archivedAt)}</span>
                </span>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={busy}
                  aria-label={`Restore ${f.name}`}
                  onClick={() => void restore(f)}
                >
                  Restore
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  aria-label={`Delete ${f.name}…`}
                  aria-expanded={deleting === f.operationId}
                  onClick={() => setDeleting((d) => (d === f.operationId ? null : f.operationId))}
                >
                  Delete…
                </Button>
              </div>
              {deleting === f.operationId && (
                <DeleteOperationForm operation={f} api={api} onDeleted={() => deleted(f)} />
              )}
            </li>
          ))}
        </ul>
      )}
      {error && <FormAlert>{error}</FormAlert>}
      <div role="status" aria-live="polite" className="rg-operation-settings__status">
        {status}
      </div>
    </section>
  );
}
