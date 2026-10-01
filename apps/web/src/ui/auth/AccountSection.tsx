/**
 * Account block at the top of the settings dialog: who is signed in, the
 * entry points to the invite and add-floor dialogs for owners and admins,
 * and sign-out.
 */
import { canManageOffice, useSessionStore } from "../../state/session.ts";
import { useUiStore } from "../../state/ui.ts";
import { Button } from "../components/Button.tsx";
import { ADD_FLOOR_OVERLAY } from "../floors/AddFloorDialog.tsx";
import { useSignOut } from "./context.tsx";
import { roleName } from "./format.ts";
import { INVITE_OVERLAY } from "./InviteDialog.tsx";

export function AccountSection() {
  const user = useSessionStore((s) => s.user);
  const openOverlay = useUiStore((s) => s.openOverlay);
  const signOut = useSignOut();
  if (!user) return null;
  return (
    <div className="rg-field">
      <div className="rg-field__label">Account</div>
      <div>
        Signed in as <strong>{user.displayName}</strong>{" "}
        <span className="rg-muted">({roleName(user.role)})</span>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
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
            onClick={() => openOverlay(ADD_FLOOR_OVERLAY)}
          >
            New operation…
          </Button>
        )}
        <Button variant="destructive" size="sm" onClick={() => void signOut()}>
          Sign out
        </Button>
      </div>
    </div>
  );
}
