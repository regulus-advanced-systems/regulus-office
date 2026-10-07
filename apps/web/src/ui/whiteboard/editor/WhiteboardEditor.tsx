/**
 * The live whiteboard editor (#45, SPEC §9.4 "click = full-screen
 * Excalidraw"): Excalidraw bound to the board's Y.Doc with y-excalidraw,
 * live cursors and names over Yjs awareness, read-only for `view` access.
 * While this human draws, the wall snapshot is rendered (`exportToBlob`) and
 * uploaded at most every 2 s, and once more when the editor closes.
 *
 * This module is the lazy chunk: Excalidraw, its CSS, Yjs and y-websocket
 * load only when someone opens a board (WhiteboardHost).
 */
import { Excalidraw, exportToBlob } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import "@excalidraw/excalidraw/index.css";
import { WHITEBOARD_SNAPSHOT_MAX_PX, WHITEBOARD_SNAPSHOT_THROTTLE_MS } from "@regulus/protocol";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ExcalidrawBinding } from "y-excalidraw";
import * as Y from "yjs";
import { type BoardSync, openBoardSync } from "../../../net/whiteboardSync.ts";
import { statsEnabled } from "../../../scene/perf/stats.ts";
import { useSessionStore } from "../../../state/session.ts";
import { createWhiteboardApi, cursorColor, type WhiteboardApi } from "../api.ts";
import { createSnapshotThrottle } from "../snapshotThrottle.ts";
import type { EditorStatus, WhiteboardEditorProps } from "../WhiteboardHost.tsx";
import { blankPng, snapshotSize } from "./snapshotRender.ts";

declare global {
  interface Window {
    EXCALIDRAW_ASSET_PATH?: string | string[];
    /** The open whiteboard, only when `?stats` is set (e2e probes). */
    __regulusWhiteboard?: {
      boardId: string;
      ids(): string[];
      status(): string;
      snapshots(): number;
    };
  }
}

/** Render the scene for the wall: white background, light theme, at most 1600 px. */
async function renderSnapshot(api: ExcalidrawImperativeAPI): Promise<Blob> {
  const elements = api.getSceneElements().filter((e) => !e.isDeleted);
  if (elements.length === 0) return blankPng();
  return exportToBlob({
    elements,
    files: api.getFiles(),
    appState: {
      ...api.getAppState(),
      exportBackground: true,
      exportWithDarkMode: false,
      viewBackgroundColor: "#ffffff",
    },
    mimeType: "image/png",
    exportPadding: 24,
    getDimensions: (width: number, height: number) =>
      snapshotSize(width, height, WHITEBOARD_SNAPSHOT_MAX_PX),
  });
}

const DARK = "(prefers-color-scheme: dark)";

/** Night shift or day shift: the board follows the system theme like the HUD does. */
function usePrefersDark(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window.matchMedia !== "function") return () => {};
      const query = window.matchMedia(DARK);
      query.addEventListener("change", onChange);
      return () => query.removeEventListener("change", onChange);
    },
    () => (typeof window.matchMedia === "function" ? window.matchMedia(DARK).matches : false),
  );
}

export default function WhiteboardEditor({ boardId, onStatus, api }: WhiteboardEditorProps) {
  const rest = useRef<WhiteboardApi>(api ?? createWhiteboardApi());
  const user = useSessionStore((s) => s.user);
  const [access, setAccess] = useState<"edit" | "view" | null>(null);
  /** Bumped when the server says this human's access changed: ask again and reopen (#244). */
  const [generation, setGeneration] = useState(0);
  const [sync, setSync] = useState<BoardSync | null>(null);
  const [excalidraw, setExcalidraw] = useState<ExcalidrawImperativeAPI | null>(null);
  const [binding, setBinding] = useState<ExcalidrawBinding | null>(null);
  const container = useRef<HTMLDivElement>(null);
  const dark = usePrefersDark();
  const status = useRef<EditorStatus>("loading");
  const report = (next: EditorStatus) => {
    status.current = next;
    onStatus?.(next);
  };

  // Access first (read-only boards open in view mode), then the Yjs connection.
  useEffect(() => {
    let live = true;
    let opened: BoardSync | null = null;
    let lost = false;
    report("loading");
    rest.current
      .info(boardId)
      .then((info) => {
        if (!live) return;
        setAccess(info.access);
        const me = user ?? { id: "anonymous", displayName: "Guest" };
        opened = openBoardSync(
          boardId,
          { name: me.displayName, color: cursorColor(me.id) },
          {
            onAccessClosed: (kind) => {
              if (!live) return;
              if (kind === "changed") {
                // Edit became read-only (or the reverse): open again with what applies now.
                setGeneration((n) => n + 1);
                return;
              }
              lost = true;
              // Strokes would go nowhere now: freeze the canvas.
              setAccess("view");
              report("revoked");
            },
          },
        );
        opened.provider.on("status", ({ status: s }: { status: string }) => {
          if (lost) return;
          report(s === "connected" ? (info.access === "view" ? "read_only" : "live") : "offline");
        });
        setSync(opened);
      })
      .catch(() => live && report("unavailable"));
    return () => {
      live = false;
      opened?.destroy();
      setSync(null);
    };
    // `user` is read once per board; a rename shows on the next open.
  }, [boardId, generation]);

  // Bind Excalidraw to the document once both exist.
  useEffect(() => {
    if (!sync || !excalidraw) return;
    const undo = new Y.UndoManager(sync.elements);
    const b = new ExcalidrawBinding(
      sync.elements,
      sync.assets,
      excalidraw,
      sync.provider.awareness,
      container.current ? { excalidrawDom: container.current, undoManager: undo } : undefined,
    );
    setBinding(b);
    return () => {
      b.destroy();
      undo.destroy();
      setBinding(null);
    };
  }, [sync, excalidraw]);

  // The wall snapshot: only this human's own strokes trigger an upload.
  useEffect(() => {
    if (!sync || !excalidraw || !binding || access !== "edit") return;
    let uploads = 0;
    const throttle = createSnapshotThrottle({
      intervalMs: WHITEBOARD_SNAPSHOT_THROTTLE_MS,
      run: async () => {
        await rest.current.uploadSnapshot(boardId, await renderSnapshot(excalidraw));
        uploads += 1;
      },
    });
    const onUpdate = (_update: Uint8Array, origin: unknown) => {
      if (origin === binding) throttle.poke();
    };
    sync.doc.on("update", onUpdate);
    if (statsEnabled(window.location.search)) {
      window.__regulusWhiteboard = {
        boardId,
        ids: () =>
          excalidraw
            .getSceneElements()
            .filter((e) => !e.isDeleted)
            .map((e) => e.id),
        status: () => status.current,
        snapshots: () => uploads,
      };
    }
    return () => {
      sync.doc.off("update", onUpdate);
      // Closing the board: the wall gets the last strokes too.
      void throttle.flush();
      if (window.__regulusWhiteboard?.boardId === boardId) window.__regulusWhiteboard = undefined;
    };
  }, [sync, excalidraw, binding, access, boardId]);

  return (
    <div ref={container} className="rg-whiteboard__canvas" data-board={boardId}>
      {access && (
        <Excalidraw
          excalidrawAPI={setExcalidraw}
          viewModeEnabled={access === "view"}
          isCollaborating
          theme={dark ? "dark" : "light"}
          onPointerUpdate={binding?.onPointerUpdate}
          UIOptions={{
            canvasActions: { loadScene: false, saveToActiveFile: false, export: false },
          }}
        />
      )}
    </div>
  );
}
