/**
 * The full-screen whiteboard (#45, SPEC §9.4): opened from a board on a wall
 * (scene/whiteboard), it takes the keyboard (scene hotkeys and WASD pause)
 * and shows the Excalidraw editor, which is loaded on first open only: the
 * editor chunk (Excalidraw, Yjs) never weighs on the main bundle. Closing
 * goes back to the room; the editor uploads its last snapshot as it goes.
 */
import { type ComponentType, lazy, Suspense, useEffect, useMemo, useState } from "react";
import { useUiStore } from "../../state/ui.ts";
import { CloseButton } from "../components/CloseButton.tsx";
import type { WhiteboardApi } from "./api.ts";
import { useWhiteboardStore, WHITEBOARD_OVERLAY } from "./whiteboardStore.ts";
import "./whiteboard.css";

export type EditorStatus = "loading" | "live" | "read_only" | "offline" | "unavailable";

export interface WhiteboardEditorProps {
  boardId: string;
  onStatus?: (status: EditorStatus) => void;
  api?: WhiteboardApi;
}

export type EditorModule = { default: ComponentType<WhiteboardEditorProps> };

/** Excalidraw fetches its fonts from here (served by the office, see excalidrawFonts.ts). */
export function setExcalidrawAssetPath(): void {
  (window as { EXCALIDRAW_ASSET_PATH?: string }).EXCALIDRAW_ASSET_PATH =
    `${window.location.origin}/excalidraw/`;
}

export const loadWhiteboardEditor = (): Promise<EditorModule> => {
  setExcalidrawAssetPath();
  return import("./editor/WhiteboardEditor.tsx");
};

const STATUS_TEXT: Record<EditorStatus, string> = {
  loading: "Connecting…",
  live: "Live",
  read_only: "Read only",
  offline: "Offline, reconnecting…",
  unavailable: "This board is not available",
};

export interface WhiteboardHostProps {
  /** Loads the editor chunk (tests pass a stand-in). */
  load?: () => Promise<EditorModule>;
  api?: WhiteboardApi;
}

export function WhiteboardHost({ load = loadWhiteboardEditor, api }: WhiteboardHostProps) {
  const open = useWhiteboardStore((s) => s.open);
  const close = useWhiteboardStore((s) => s.close);
  const openOverlay = useUiStore((s) => s.openOverlay);
  const closeOverlay = useUiStore((s) => s.closeOverlay);
  const Editor = useMemo(() => lazy(load), [load]);
  const [status, setStatus] = useState<EditorStatus>("loading");

  useEffect(() => {
    if (!open) return;
    openOverlay(WHITEBOARD_OVERLAY);
    return () => closeOverlay(WHITEBOARD_OVERLAY);
  }, [open, openOverlay, closeOverlay]);

  if (!open) return null;
  return (
    <div
      className="rg-whiteboard"
      role="dialog"
      aria-modal="true"
      aria-label={`Whiteboard: ${open.title}`}
    >
      <header className="rg-whiteboard__bar">
        <h2 className="rg-whiteboard__title">
          Whiteboard <span className="rg-whiteboard__room">{open.title}</span>
        </h2>
        <span className={`rg-whiteboard__status rg-whiteboard__status--${status}`} role="status">
          {STATUS_TEXT[status]}
        </span>
        <CloseButton onClick={close} label="Close whiteboard" />
      </header>
      <div className="rg-whiteboard__body">
        <Suspense fallback={<p className="rg-whiteboard__loading">Loading whiteboard…</p>}>
          <Editor key={open.boardId} boardId={open.boardId} onStatus={setStatus} api={api} />
        </Suspense>
      </div>
    </div>
  );
}
