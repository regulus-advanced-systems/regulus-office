/**
 * HUD side of the task queue (#37): the panel and the "Queue a task" dialog,
 * which own the keyboard while open. Leaving the room closes both.
 */
import { useEffect } from "react";
import { useFloorStore } from "../../state/floor.ts";
import { useUiStore } from "../../state/ui.ts";
import { QueuePanel } from "./QueuePanel.tsx";
import { QueueTaskDialog } from "./QueueTaskDialog.tsx";
import { QUEUE_OVERLAY, useQueueStore } from "./queueStore.ts";
import "./queue.css";

export function QueueHost() {
  const panelOpen = useQueueStore((s) => s.panelOpen);
  const add = useQueueStore((s) => s.add);
  const openOverlay = useUiStore((s) => s.openOverlay);
  const closeOverlay = useUiStore((s) => s.closeOverlay);
  const floorId = useFloorStore((s) => s.floorId);
  const open = panelOpen || add !== null;
  useEffect(() => {
    if (!open) return;
    openOverlay(QUEUE_OVERLAY);
    return () => closeOverlay(QUEUE_OVERLAY);
  }, [open, openOverlay, closeOverlay]);
  useEffect(() => {
    // A new room: its queue UI starts closed.
    void floorId;
    useQueueStore.getState().closePanel();
    useQueueStore.getState().closeAdd();
  }, [floorId]);
  return (
    <>
      {panelOpen && add === null && <QueuePanel />}
      {add !== null && <QueueTaskDialog prefill={add.prefill} />}
    </>
  );
}
