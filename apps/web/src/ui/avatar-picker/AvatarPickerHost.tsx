/**
 * Mounts the genius picker in the office: opens it once per visit while the
 * human has not chosen a genius yet (first login, and anyone migrated from
 * the henchman avatars), and whenever Settings asks for it.
 */
import { useEffect } from "react";
import { useSessionStore } from "../../state/session.ts";
import { useUiStore } from "../../state/ui.ts";
import { AvatarPicker } from "./AvatarPicker.tsx";
import { GENIUS_OVERLAY, openGeniusPicker, usePickerStore } from "./pickerStore.ts";

export function AvatarPickerHost() {
  const overlay = useUiStore((s) => s.overlay);
  const reason = usePickerStore((s) => s.reason);
  const prompted = usePickerStore((s) => s.prompted);
  const needsPick = useSessionStore((s) => s.user?.avatarChosen === false);

  useEffect(() => {
    if (needsPick && !prompted && overlay === null) openGeniusPicker("first_login");
  }, [needsPick, prompted, overlay]);

  return <AvatarPicker open={overlay === GENIUS_OVERLAY} reason={reason} />;
}
