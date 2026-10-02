/**
 * HUD side of the meeting room (#50): keeps the meeting store current, shows
 * the panel and the start dialog (they own the keyboard while open), and
 * closes both on leaving the room. `MeetingRoomButton` is the Rooms panel's
 * entry in a project room.
 */
import { useEffect } from "react";
import { getOfficeClient } from "../../net/index.ts";
import { useOperationStore } from "../../state/operation.ts";
import { useUiStore } from "../../state/ui.ts";
import { Button } from "../components/Button.tsx";
import { createMeetingsApi } from "./api.ts";
import { MeetingPanel } from "./MeetingPanel.tsx";
import { MeetingStartDialog } from "./MeetingStartDialog.tsx";
import { liveMeetingIn, MEETING_OVERLAY, useMeetingStore } from "./meetingStore.ts";
import { type MeetingSyncDeps, useMeetingSync } from "./meetingSync.ts";
import "./meetings.css";

const api = createMeetingsApi();

function safeClient() {
  try {
    return getOfficeClient();
  } catch {
    return null;
  }
}

const liveDeps = (): MeetingSyncDeps => ({ api, client: safeClient() });

export function MeetingHost({ deps = liveDeps }: { deps?: () => MeetingSyncDeps }) {
  useMeetingSync(deps);
  const panel = useMeetingStore((s) => s.panel !== null);
  const starting = useMeetingStore((s) => s.starting);
  const operationId = useOperationStore((s) => s.operationId);
  const openOverlay = useUiStore((s) => s.openOverlay);
  const closeOverlay = useUiStore((s) => s.closeOverlay);
  const open = panel || starting;
  useEffect(() => {
    if (!open) return;
    openOverlay(MEETING_OVERLAY);
    return () => closeOverlay(MEETING_OVERLAY);
  }, [open, openOverlay, closeOverlay]);
  useEffect(() => {
    void operationId;
    useMeetingStore.getState().closePanel();
    useMeetingStore.getState().closeStart();
  }, [operationId]);
  return (
    <>
      {panel && !starting && <MeetingPanel />}
      {starting && <MeetingStartDialog />}
    </>
  );
}

/** "Meeting room…" in the Rooms panel; lit while a meeting is in session here. */
export function MeetingRoomButton() {
  const operationId = useOperationStore((s) => s.operationId);
  const live = useMeetingStore((s) => liveMeetingIn(s.active, operationId));
  const openPanel = useMeetingStore((s) => s.openPanel);
  if (!operationId) return null;
  return (
    <Button
      variant={live ? "primary" : "secondary"}
      size="sm"
      aria-haspopup="dialog"
      title={live ? `Meeting in session: ${live.title}` : "Call or review this room's meetings"}
      onClick={() => openPanel(live?.id ?? null)}
    >
      {live ? "Meeting in session…" : "Meeting room…"}
    </Button>
  );
}
