/**
 * "Floors" in Settings, for office owners and admins (#150): archived floors,
 * each with Restore (back in the compound as it was) and Delete (permanent,
 * the same typed-name confirmation as in Floor settings).
 */
import type { FloorInfo } from "@regulus/protocol";
import { useCallback, useEffect, useState } from "react";
import { useFloorsStore } from "../../state/floors.ts";
import { canManageOffice, useSessionStore } from "../../state/session.ts";
import { FormAlert } from "../auth/AuthCard.tsx";
import { Button } from "../components/Button.tsx";
import { createFloorsApi, describeFloorError, type FloorsApi } from "../floors/api.ts";
import { DeleteFloorForm } from "../floors/FloorDangerZone.tsx";
import "../floors/floors.css";

const defaultApi = createFloorsApi();

function archivedOn(at: number | null): string {
  return at ? new Date(at).toLocaleDateString() : "";
}

export function FloorsSection({ api = defaultApi }: { api?: FloorsApi }) {
  const allowed = useSessionStore((s) => canManageOffice(s.user?.role));
  const refreshFloors = useFloorsStore((s) => s.refresh);
  const [archived, setArchived] = useState<FloorInfo[] | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");

  const load = useCallback(async () => {
    const res = await api.archived();
    if (res.ok) setArchived(res.data.floors);
    else setError(describeFloorError(res));
  }, [api]);

  useEffect(() => {
    if (allowed) void load();
  }, [allowed, load]);

  if (!allowed) return null;

  const restore = async (floor: FloorInfo) => {
    setBusy(true);
    setError(null);
    setStatus("");
    const res = await api.restore(floor.floorId);
    setBusy(false);
    if (!res.ok) return setError(describeFloorError(res));
    setStatus(`${floor.name} is back in the compound.`);
    await Promise.all([load(), refreshFloors(api)]);
  };

  const deleted = async (floor: FloorInfo) => {
    setDeleting(null);
    setStatus(`${floor.name} was deleted.`);
    await load();
  };

  return (
    <section className="rg-field" aria-label="Operations">
      <div className="rg-field__label">Operations</div>
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
            <li key={f.floorId} className="rg-archived-floor">
              <div className="rg-danger-zone__row">
                <span style={{ flex: "1 1 auto" }}>
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
                  aria-expanded={deleting === f.floorId}
                  onClick={() => setDeleting((d) => (d === f.floorId ? null : f.floorId))}
                >
                  Delete…
                </Button>
              </div>
              {deleting === f.floorId && (
                <DeleteFloorForm floor={f} api={api} onDeleted={() => deleted(f)} />
              )}
            </li>
          ))}
        </ul>
      )}
      {error && <FormAlert>{error}</FormAlert>}
      <div role="status" aria-live="polite" className="rg-floor-settings__status">
        {status}
      </div>
    </section>
  );
}
