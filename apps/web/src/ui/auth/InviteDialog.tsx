/**
 * Invite dialog (SPEC §4.2 Auth, §5 `invites`): an owner or admin picks a
 * role and gets a single-use `/join/<token>` link to hand over, with its
 * expiry. Admins cannot mint owner invites (the server enforces it too).
 * The link is shown only here and copied on request; it is not stored.
 */
import { USER_ROLES, type UserRole } from "@regulus/protocol/src/enums.ts";
import { useId, useRef, useState } from "react";
import { canManageOffice, useSessionStore } from "../../state/session.ts";
import { useUiStore } from "../../state/ui.ts";
import { Button } from "../components/Button.tsx";
import { Modal } from "../components/Modal.tsx";
import { FormAlert } from "./AuthCard.tsx";
import { type CreatedInvite, describeAuthError } from "./api.ts";
import { useAuthDeps } from "./context.tsx";
import { expiresIn, formatExpiry, roleHint, roleName } from "./format.ts";

export const INVITE_OVERLAY = "invite";

/** Roles `actor` may hand out: owners any, admins anything but owner, others none. */
export function invitableRoles(actor: UserRole | undefined): UserRole[] {
  if (!canManageOffice(actor)) return [];
  return USER_ROLES.filter((r) => r !== "owner" || actor === "owner");
}

async function copyText(text: string, fallback: HTMLInputElement | null): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Clipboard API unavailable (http origin, permissions): select it for Ctrl+C.
    fallback?.focus();
    fallback?.select();
    return false;
  }
}

export function InviteForm() {
  const role = useSessionStore((s) => s.user?.role);
  const toast = useUiStore((s) => s.toast);
  const { api } = useAuthDeps();
  const roles = invitableRoles(role);
  const [picked, setPicked] = useState<UserRole>("member");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invite, setInvite] = useState<CreatedInvite | null>(null);
  const linkRef = useRef<HTMLInputElement>(null);
  const selectId = useId();
  const linkId = useId();

  if (roles.length === 0)
    return <FormAlert>Only owners and admins can invite people to the office.</FormAlert>;

  const create = async () => {
    setBusy(true);
    setError(null);
    const r = await api.createInvite(picked);
    setBusy(false);
    if (r.ok) setInvite(r.data);
    else setError(describeAuthError(r));
  };

  const copy = async () => {
    if (!invite) return;
    const done = await copyText(invite.url, linkRef.current);
    toast(
      done
        ? { kind: "success", message: "Invite link copied." }
        : { kind: "info", message: "Press Ctrl+C to copy the selected link." },
    );
  };

  if (invite)
    return (
      <div>
        <div className="rg-field">
          <label className="rg-field__label" htmlFor={linkId}>
            Invite link for {roleName(invite.role).toLowerCase()}
          </label>
          <div className="rg-copy-row">
            <input
              id={linkId}
              ref={linkRef}
              className="rg-input"
              readOnly
              value={invite.url}
              onFocus={(e) => e.currentTarget.select()}
            />
            <Button variant="primary" onClick={() => void copy()}>
              Copy
            </Button>
          </div>
          <div className="rg-field__hint">
            Works once. Expires {formatExpiry(invite.expiresAt)} ({expiresIn(invite.expiresAt)}).
          </div>
        </div>
        <Button variant="secondary" size="sm" onClick={() => setInvite(null)}>
          Create another
        </Button>
      </div>
    );

  return (
    <div>
      <div className="rg-field">
        <label className="rg-field__label" htmlFor={selectId}>
          Role
        </label>
        <select
          id={selectId}
          className="rg-select"
          value={picked}
          onChange={(e) => setPicked(e.currentTarget.value as UserRole)}
        >
          {roles.map((r) => (
            <option key={r} value={r}>
              {roleName(r)}
            </option>
          ))}
        </select>
        <div className="rg-field__hint">{roleHint(picked)}</div>
      </div>
      {error && <FormAlert>{error}</FormAlert>}
      <Button variant="primary" onClick={() => void create()} disabled={busy}>
        {busy ? "Creating…" : "Create invite link"}
      </Button>
    </div>
  );
}

/** Mounted on /office; shows the dialog while the `invite` overlay is open, for managers only. */
export function InviteDialogHost() {
  const open = useUiStore((s) => s.overlay === INVITE_OVERLAY);
  const close = useUiStore((s) => s.closeOverlay);
  const allowed = useSessionStore((s) => canManageOffice(s.user?.role));
  if (!allowed) return null;
  return (
    <Modal
      open={open}
      onClose={() => close(INVITE_OVERLAY)}
      title="Invite someone"
      width={480}
      footer={
        <Button variant="secondary" onClick={() => close(INVITE_OVERLAY)}>
          Done
        </Button>
      }
    >
      <InviteForm />
    </Modal>
  );
}
