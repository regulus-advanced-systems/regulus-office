/**
 * Operation settings panel (SPEC §5 `operation_members`, §11): who may use an operation
 * and how (view / spawn henchmen / manage), without touching the API by hand.
 * Opened from the elevator (gear beside an operation), from the top bar while on
 * the operation, and right after "Add operation". Shown only to people the operation list
 * says may manage the operation; the server checks every call again. Office
 * owners and admins also get the Danger zone: archive and delete (#150).
 */
import type { OfficeUserInfo, OperationAccess, OperationMemberInfo } from "@regulus/protocol";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useOperationsStore } from "../../state/operations.ts";
import { useSessionStore } from "../../state/session.ts";
import { useUiStore } from "../../state/ui.ts";
import { FormAlert } from "../auth/AuthCard.tsx";
import type { ApiFailure, ApiResult } from "../auth/api.ts";
import { Button } from "../components/Button.tsx";
import { Modal } from "../components/Modal.tsx";
import { createOperationsApi, describeOperationError, type OperationsApi } from "./api.ts";
import { OperationDangerZone } from "./OperationDangerZone.tsx";
import { AccessFromGitHubNote, AddPeople, MemberList } from "./OperationMembers.tsx";
import {
  ACCESS_HINT,
  ACCESS_LABELS,
  canManageOperation,
  effectiveGrant,
  operationIdFromOverlay,
} from "./operationSettings.ts";
import "./operations.css";

const defaultApi = createOperationsApi();

export function OperationSettingsBody({
  operationId,
  api,
}: {
  operationId: string;
  api: OperationsApi;
}) {
  const operation = useOperationsStore((s) =>
    s.operations?.find((f) => f.operationId === operationId),
  );
  const refreshOperations = useOperationsStore((s) => s.refresh);
  const meId = useSessionStore((s) => s.user?.id);
  const [members, setMembers] = useState<OperationMemberInfo[] | null>(null);
  const [people, setPeople] = useState<OfficeUserInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const roles = useMemo(() => new Map(people.map((p) => [p.userId, p.role])), [people]);

  const reload = useCallback(async () => {
    const [m, p] = await Promise.all([api.members(operationId), api.people()]);
    if (m.ok) setMembers(m.data.members);
    else setError(describeOperationError(m));
    if (p.ok) setPeople(p.data.users);
    else if (m.ok) setError(describeOperationError(p));
  }, [api, operationId]);

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
    // Changing your own access can take the operation (or this panel) away from you.
    if (touchesMe) await refreshOperations(api);
    setBusy(false);
    if (failed) setError(describeOperationError(failed));
    else setStatus(done);
    return failed === null;
  };

  const change = (m: OperationMemberInfo, access: OperationAccess) =>
    void apply(
      [() => api.setMember(operationId, m.userId, access)],
      `${m.displayName} is now limited to ${ACCESS_LABELS[access]}.`,
      m.userId === meId,
    );
  const remove = (m: OperationMemberInfo) =>
    void apply(
      [() => api.removeMember(operationId, m.userId)],
      `The limit for ${m.displayName} is lifted.`,
      m.userId === meId,
    );
  const add = (picked: OfficeUserInfo[], access: OperationAccess) =>
    apply(
      picked.map((p) => () => api.setMember(operationId, p.userId, effectiveGrant(p.role, access))),
      `Limited ${picked.map((p) => p.displayName).join(", ")}.`,
      false,
    );

  return (
    <div className="rg-operation-settings">
      <p>
        Who can use <strong>{operation?.name ?? "this operation"}</strong>.
      </p>
      <AccessFromGitHubNote />
      <p className="rg-field__hint">{ACCESS_HINT}</p>
      <h2 className="rg-operation-settings__heading">Limits</h2>
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
      <h2 className="rg-operation-settings__heading">Limit someone</h2>
      {members !== null && <AddPeople people={people} members={members} busy={busy} onAdd={add} />}
      {error && <FormAlert>{error}</FormAlert>}
      <div role="status" aria-live="polite" className="rg-operation-settings__status">
        {status}
      </div>
      {operation && <OperationDangerZone operation={operation} api={api} />}
    </div>
  );
}

/** Mounted in the HUD; renders only for an operation the signed-in user may manage. */
export function OperationSettingsDialogHost({ api = defaultApi }: { api?: OperationsApi }) {
  const overlay = useUiStore((s) => s.overlay);
  const close = useUiStore((s) => s.closeOverlay);
  const operationId = operationIdFromOverlay(overlay);
  const loaded = useOperationsStore((s) => s.operations !== null);
  const allowed = useOperationsStore((s) => canManageOperation(s.operations, operationId));
  // Lost manage (e.g. removed yourself) or the operation is gone: let go of the keyboard too.
  useEffect(() => {
    if (operationId && loaded && !allowed) close(overlay ?? undefined);
  }, [operationId, loaded, allowed, close, overlay]);
  if (!operationId || !allowed) return null;
  const done = () => close(overlay ?? undefined);
  return (
    <Modal
      open
      onClose={done}
      title="Operation settings"
      width={560}
      footer={
        <Button variant="primary" onClick={done}>
          Done
        </Button>
      }
    >
      <OperationSettingsBody key={operationId} operationId={operationId} api={api} />
    </Modal>
  );
}
