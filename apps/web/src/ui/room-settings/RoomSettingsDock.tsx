/**
 * Room settings, docked (#187): a non-modal panel at the bottom right, so
 * the room stays in view and shows every unsaved change live (desks rise
 * in, the decor swaps). Opened from the Rooms panel in a room the user
 * manages; Escape or Close shuts it and drops the preview.
 */
import { useEffect, useId, useMemo, useRef } from "react";
import { create } from "zustand";
import { useRoomDraftStore } from "../../scene/compound/build/preview.ts";
import { useCompoundStore } from "../../state/compound.ts";
import { useBuildModeStore } from "../build-mode/store.ts";
import { Button } from "../components/Button.tsx";
import { Panel } from "../Panel.tsx";
import { createRoomSettingsApi, type RoomSettingsApi } from "./api.ts";
import { type RoomDraftValues, RoomSettingsPanel } from "./RoomSettingsPanel.tsx";
import "../build-mode/build-mode.css";

export const useRoomSettingsDock = create<{
  operationId: string | null;
  open(operationId: string): void;
  close(): void;
}>()((set) => ({
  operationId: null,
  open: (operationId) => set({ operationId }),
  close: () => {
    useRoomDraftStore.getState().set(null);
    set({ operationId: null });
  },
}));

const defaultApi = createRoomSettingsApi();

export function RoomSettingsDock({ api = defaultApi }: { api?: RoomSettingsApi }) {
  const operationId = useRoomSettingsDock((s) => s.operationId);
  const close = useRoomSettingsDock((s) => s.close);
  const building = useBuildModeStore((s) => s.intent !== null);
  const name = useCompoundStore((s) =>
    operationId ? s.world?.rooms.find((r) => r.id === operationId)?.name : undefined,
  );
  const title = useId();
  const ref = useRef<HTMLDivElement>(null);
  const onDraft = useMemo(
    () => (d: RoomDraftValues) => {
      if (operationId) useRoomDraftStore.getState().set({ operationId, ...d });
    },
    [operationId],
  );
  // Build mode takes the corner (and the keyboard): settings close for it.
  useEffect(() => {
    if (building && operationId) close();
  }, [building, operationId, close]);
  useEffect(() => {
    if (operationId) ref.current?.focus();
  }, [operationId]);
  if (!operationId || building) return null;
  return (
    <div
      ref={ref}
      role="dialog"
      aria-modal="false"
      aria-labelledby={title}
      tabIndex={-1}
      className="rg-dock"
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        e.stopPropagation();
        close();
      }}
    >
      <Panel title={<span id={title}>Room settings{name ? `: ${name}` : ""}</span>}>
        <RoomSettingsPanel
          key={operationId}
          operationId={operationId}
          api={api}
          onDraft={onDraft}
        />
        <div className="rg-dock__actions">
          <Button variant="secondary" size="sm" onClick={close}>
            Close
          </Button>
        </div>
      </Panel>
    </div>
  );
}
