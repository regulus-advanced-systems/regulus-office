/**
 * Floor settings panel (SPEC §5 `floor_members`, §11): who may use a floor
 * and how (view / spawn robots / manage), without touching the API by hand.
 * Opened from the elevator (gear beside a floor), from the top bar while on
 * the floor, and right after "Add floor". Shown only to people the floor list
 * says may manage the floor; the server checks every call again.
 */
import type { FloorAccess, FloorMemberInfo, OfficeUserInfo } from "@regulus/protocol";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useFloorsStore } from "../../state/floors.ts";
import { useSessionStore } from "../../state/session.ts";
import { useUiStore } from "../../state/ui.ts";
import { FormAlert } from "../auth/AuthCard.tsx";
import type { ApiFailure, ApiResult } from "../auth/api.ts";
import { Button } from "../components/Button.tsx";
import { Modal } from "../components/Modal.tsx";
import { createFloorsApi, describeFloorError, type FloorsApi } from "./api.ts";
import { AddPeople, MemberList, OfficeManagersNote } from "./FloorMembers.tsx";
import {
  ACCESS_HINT,
  ACCESS_LABELS,
  canManageFloor,
  effectiveGrant,
  floorIdFromOverlay,
} from "./floorSettings.ts";
import "./floors.css";

const defaultApi = createFloorsApi();

export function FloorSettingsBody({ floorId, api }: { floorId: string; api: FloorsApi }) {
  const floor = useFloorsStore((s) => s.floors?.find((f) => f.floorId === floorId));
  const refreshFloors = useFloorsStore((s) => s.refresh);
  const meId = useSessionStore((s) => s.user?.id);
  const [members, setMembers] = useState<FloorMemberInfo[] | null>(null);
  const [people, setPeople] = useState<OfficeUserInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const roles = useMemo(() => new Map(people.map((p) => [p.userId, p.role])), [people]);

  const reload = useCallback(async () => {
    const [m, p] = await Promise.all([api.members(floorId), api.people()]);
    if (m.ok) setMembers(m.data.members);
    else setError(describeFloorError(m));
    if (p.ok) setPeople(p.data.users);
    else if (m.ok) setError(describeFloorError(p));
  }, [api, floorId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  /** Run one or more member calls, then re-read the list; true when all succeeded. */
  const apply = async (
    calls: (() => Promise<ApiResult<void>>)[],
    done: string,
    touchesMe: boolean,
  ): Promise<boolean> => {
    setBusy(true);
    setError(null);
    setStatus("");
    let failed: ApiFailure | null = null;
    for (const call of calls) {
      const result = await call();
      if (!result.ok) failed = result;
    }
    await reload();
    // Changing your own access can take the floor (or this panel) away from you.
    if (touchesMe) await refreshFloors(api);
    setBusy(false);
    if (failed) setError(describeFloorError(failed));
    else setStatus(done);
    return failed === null;
  };

  const change = (m: FloorMemberInfo, access: FloorAccess) =>
    void apply(
      [() => api.setMember(floorId, m.userId, access)],
      `${m.displayName} now has ${ACCESS_LABELS[access]} access.`,
      m.userId === meId,
    );
  const remove = (m: FloorMemberInfo) =>
    void apply(
      [() => api.removeMember(floorId, m.userId)],
      `${m.displayName} no longer has access.`,
      m.userId === meId,
    );
  const add = (picked: OfficeUserInfo[], access: FloorAccess) =>
    apply(
      picked.map((p) => () => api.setMember(floorId, p.userId, effectiveGrant(p.role, access))),
      `Added ${picked.map((p) => p.displayName).join(", ")}.`,
      false,
    );

  return (
    <div className="rg-floor-settings">
      <p>
        Who can use <strong>{floor?.name ?? "this floor"}</strong>
        {floor ? ` (floor ${floor.index})` : ""}.
      </p>
      <p className="rg-field__hint">{ACCESS_HINT}</p>
      <OfficeManagersNote people={people} />
      <h2 className="rg-floor-settings__heading">People with access</h2>
      {members === null ? (
        !error && <p className="rg-muted">Loading…</p>
      ) : (
        <MemberList
          members={members}
          roles={roles}
          meId={meId}
          busy={busy}
          onChange={change}
          onRemove={remove}
        />
      )}
      <h2 className="rg-floor-settings__heading">Add people</h2>
      {members !== null && <AddPeople people={people} members={members} busy={busy} onAdd={add} />}
      {error && <FormAlert>{error}</FormAlert>}
      <div role="status" aria-live="polite" className="rg-floor-settings__status">
        {status}
      </div>
    </div>
  );
}

/** Mounted in the HUD; renders only for a floor the signed-in user may manage. */
export function FloorSettingsDialogHost({ api = defaultApi }: { api?: FloorsApi }) {
  const overlay = useUiStore((s) => s.overlay);
  const close = useUiStore((s) => s.closeOverlay);
  const floorId = floorIdFromOverlay(overlay);
  const loaded = useFloorsStore((s) => s.floors !== null);
  const allowed = useFloorsStore((s) => canManageFloor(s.floors, floorId));
  // Lost manage (e.g. removed yourself) or the floor is gone: let go of the keyboard too.
  useEffect(() => {
    if (floorId && loaded && !allowed) close(overlay ?? undefined);
  }, [floorId, loaded, allowed, close, overlay]);
  if (!floorId || !allowed) return null;
  const done = () => close(overlay ?? undefined);
  return (
    <Modal
      open
      onClose={done}
      title="Floor settings"
      width={560}
      footer={
        <Button variant="primary" onClick={done}>
          Done
        </Button>
      }
    >
      <FloorSettingsBody key={floorId} floorId={floorId} api={api} />
    </Modal>
  );
}
