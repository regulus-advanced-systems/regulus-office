/**
 * Account block at the top of the settings dialog: who is signed in, the
 * entry points to the invite and add-operation dialogs for owners and admins,
 * and sign-out.
 */
import { canManageOffice, useSessionStore } from "../../state/session.ts";
import { useUiStore } from "../../state/ui.ts";
import { Button } from "../components/Button.tsx";
import { ADD_OPERATION_OVERLAY } from "../operations/AddOperationDialog.tsx";
import { useSignOut } from "./context.tsx";
import { roleName } from "./format.ts";
import { INVITE_OVERLAY } from "./InviteDialog.tsx";

export function AccountSection() {
  const user = useSessionStore((s) => s.user);
  const openOverlay = useUiStore((s) => s.openOverlay);
  const signOut = useSignOut();
  if (!user) return null;
  return (
    <section className="rg-settings__group" aria-label="Account">
      <h3 className="rg-settings__heading">Account</h3>
      <div>
        Signed in as <strong>{user.displayName}</strong>{" "}
        <span className="rg-muted">({roleName(user.role)})</span>
      </div>
      <div className="rg-settings__row">
        {canManageOffice(user.role) && (
          <Button
            variant="secondary"
            size="sm"
            aria-haspopup="dialog"
            // Settings closes first so only one dialog traps focus at a time.
            onClick={() => openOverlay(INVITE_OVERLAY)}
          >
            Invite someone…
          </Button>
        )}
        {canManageOffice(user.role) && (
          <Button
            variant="secondary"
            size="sm"
            aria-haspopup="dialog"
            onClick={() => openOverlay(ADD_OPERATION_OVERLAY)}
          >
            New operation…
          </Button>
        )}
        <Button variant="destructive" size="sm" onClick={() => void signOut()}>
          Sign out
        </Button>
      </div>
    </section>
  );
}
