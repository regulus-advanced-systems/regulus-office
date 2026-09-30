/**
 * Archive and delete a floor (#150), for office owners and admins only
 * (floor managers don't see it; the server refuses them too).
 *
 * - Archive hides the floor and keeps everything; Settings → Floors restores it.
 * - Delete is permanent and needs the floor's name typed. While robots are on
 *   the floor the server refuses it with their list; "Send all home" sends
 *   them home (their branches are kept), then delete again. Nothing on
 *   GitHub is deleted.
 */
import type { FloorRobotInfo } from "@regulus/protocol";
import { useId, useState } from "react";
import { useFloorsStore } from "../../state/floors.ts";
import { canManageOffice, useSessionStore } from "../../state/session.ts";
import { FormAlert } from "../auth/AuthCard.tsx";
import { Button } from "../components/Button.tsx";
import { describeFloorError, type FloorsApi } from "./api.ts";

const STATUS_WORDS: Partial<Record<FloorRobotInfo["status"], string>> = {
  waiting_permission: "waiting for approval",
  waiting_input: "waiting for input",
};

function RobotList({ robots }: { robots: readonly FloorRobotInfo[] }) {
  return (
    <ul className="rg-danger-zone__robots" aria-label="Robots on this floor">
      {robots.map((r) => (
        <li key={r.agentId}>
          <strong>{r.taskTitle || "Robot"}</strong> ({r.ownerName},{" "}
          {STATUS_WORDS[r.status] ?? r.status})
        </li>
      ))}
    </ul>
  );
}

/** Type the name, delete; shows the robots in the way and a "Send all home" helper. */
export function DeleteFloorForm({
  floor,
  api,
  onDeleted,
}: {
  floor: { floorId: string; name: string };
  api: FloorsApi;
  onDeleted: () => void | Promise<void>;
}) {
  const inputId = useId();
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [robots, setRobots] = useState<FloorRobotInfo[]>([]);
  const matches = typed.trim() === floor.name.trim();

  const remove = async () => {
    setBusy(true);
    setError(null);
    setStatus("");
    const res = await api.remove(floor.floorId, typed);
    setBusy(false);
    if (res.ok) {
      setRobots([]);
      await onDeleted();
      return;
    }
    setRobots(res.robots ?? []);
    setError(describeFloorError(res));
  };

  const sendAllHome = async () => {
    setBusy(true);
    setError(null);
    const res = await api.sendHome(floor.floorId);
    setBusy(false);
    if (!res.ok) return setError(describeFloorError(res));
    const { sentHome, failed } = res.data;
    setRobots((left) => left.filter((r) => failed.some((f) => f.agentId === r.agentId)));
    const n = `${sentHome} robot${sentHome === 1 ? "" : "s"}`;
    if (failed.length > 0) {
      setError(`Sent ${n} home; ${failed.length} could not be: ${failed[0]?.reason ?? ""}`);
    } else {
      setStatus(`Sent ${n} home. You can delete the floor now.`);
    }
  };

  return (
    <div className="rg-danger-zone__delete">
      <p>
        This permanently deletes <strong>{floor.name}</strong>: its desks, members, robot history,
        the office's copy of its repos and everyone's clones and worktrees on it. Unpushed work in
        them is lost. Nothing on GitHub is deleted.
      </p>
      <label className="rg-field__label" htmlFor={inputId}>
        Type the floor name to confirm
      </label>
      <div className="rg-danger-zone__row">
        <input
          id={inputId}
          className="rg-input"
          autoComplete="off"
          value={typed}
          placeholder={floor.name}
          onChange={(e) => setTyped(e.currentTarget.value)}
        />
        <Button
          variant="destructive"
          size="sm"
          disabled={!matches || busy}
          onClick={() => void remove()}
        >
          Delete floor
        </Button>
      </div>
      {robots.length > 0 && (
        <>
          <RobotList robots={robots} />
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
            Each robot is stopped and sent home; its branch is kept.
          </div>
        </>
      )}
      {error && <FormAlert>{error}</FormAlert>}
      <div role="status" aria-live="polite" className="rg-floor-settings__status">
        {status}
      </div>
    </div>
  );
}

/** The "Danger zone" section of Floor settings. */
export function FloorDangerZone({
  floor,
  api,
}: {
  floor: { floorId: string; name: string };
  api: FloorsApi;
}) {
  const allowed = useSessionStore((s) => canManageOffice(s.user?.role));
  const refreshFloors = useFloorsStore((s) => s.refresh);
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!allowed) return null;

  const archive = async () => {
    setBusy(true);
    setError(null);
    const res = await api.archive(floor.floorId);
    setBusy(false);
    if (!res.ok) return setError(describeFloorError(res));
    // The floor leaves the list, which closes this dialog.
    await refreshFloors(api);
  };

  return (
    <section className="rg-danger-zone" aria-label="Danger zone">
      <h2 className="rg-floor-settings__heading">Danger zone</h2>
      <div className="rg-danger-zone__row">
        <Button variant="secondary" size="sm" disabled={busy} onClick={() => void archive()}>
          Archive floor
        </Button>
        <span className="rg-field__hint">
          Hides it from the elevator. Everything is kept; restore it from Settings → Floors.
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
          Delete floor…
        </Button>
      </div>
      {deleting && <DeleteFloorForm floor={floor} api={api} onDeleted={() => refreshFloors(api)} />}
    </section>
  );
}
