import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { act } from "react";
import { useUiStore } from "../../state/ui.ts";
import { click, mount, useDom } from "../a11y/dom.ts";
import {
  type EditorModule,
  type WhiteboardEditorProps,
  WhiteboardHost,
} from "./WhiteboardHost.tsx";
import { useWhiteboardStore, WHITEBOARD_OVERLAY } from "./whiteboardStore.ts";

useDom();

function deferredEditor() {
  let resolve: (m: EditorModule) => void = () => {};
  const calls: number[] = [];
  const promise = new Promise<EditorModule>((r) => {
    resolve = r;
  });
  const load = () => {
    calls.push(1);
    return promise;
  };
  function Stand({ boardId, onStatus }: WhiteboardEditorProps) {
    return (
      <button type="button" data-editor={boardId} onClick={() => onStatus?.("live")}>
        editor
      </button>
    );
  }
  return { load, calls, resolve: () => resolve({ default: Stand }) };
}

describe("WhiteboardHost", () => {
  test("loads the editor chunk only when a board is opened, then shows it", async () => {
    await act(async () => useWhiteboardStore.setState({ open: null }));
    const editor = deferredEditor();
    const m = await mount(<WhiteboardHost load={editor.load} />);
    expect(editor.calls).toHaveLength(0);
    expect(document.querySelector(".rg-whiteboard")).toBeNull();

    await act(async () => useWhiteboardStore.getState().openBoard("op1", "Regulus Web"));
    expect(editor.calls).toHaveLength(1);
    expect(document.querySelector(".rg-whiteboard__loading")?.textContent).toContain("Loading");
    expect(document.querySelector("[role=dialog]")?.getAttribute("aria-label")).toBe(
      "Whiteboard: Regulus Web",
    );
    // The board owns the keyboard: scene hotkeys and WASD pause.
    expect(useUiStore.getState().overlay).toBe(WHITEBOARD_OVERLAY);

    await act(async () => editor.resolve());
    const stand = document.querySelector("[data-editor]") as HTMLButtonElement;
    expect(stand.dataset.editor).toBe("op1");
    expect(document.querySelector("[role=status]")?.textContent).toBe("Connecting…");
    await click(stand);
    expect(document.querySelector("[role=status]")?.textContent).toBe("Live");

    await click(document.querySelector("[aria-label='Close whiteboard']") as HTMLButtonElement);
    expect(useWhiteboardStore.getState().open).toBeNull();
    expect(document.querySelector(".rg-whiteboard")).toBeNull();
    expect(useUiStore.getState().overlay).toBeNull();

    // Opening again reuses the loaded chunk.
    await act(async () => useWhiteboardStore.getState().openBoard("lobby", "Lobby"));
    expect(editor.calls).toHaveLength(1);
    await act(async () => useWhiteboardStore.getState().close());
    await m.unmount();
  });
});

/** Every .ts/.tsx file under `dir`. */
function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sources(path));
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(path);
  }
  return out;
}

const STATIC_IMPORT = /^\s*import\s+(?!type\b)[^;]*?from\s+["']([^"']+)["']/gm;
const HEAVY = /^(@excalidraw\/|y-excalidraw|y-websocket|yjs)/;

test("Excalidraw and Yjs are only reachable through the lazy editor chunk", () => {
  const root = join(import.meta.dir, "../..");
  const editorDir = join(import.meta.dir, "editor");
  const allowed = new Set([join(root, "net/whiteboardSync.ts")]);
  const offenders: string[] = [];
  for (const file of sources(root)) {
    const inEditor = file.startsWith(editorDir);
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(STATIC_IMPORT)) {
      const spec = match[1] ?? "";
      if (HEAVY.test(spec) && !inEditor && !allowed.has(file)) offenders.push(relative(root, file));
      // Nothing outside the editor imports the editor (or the Yjs provider) statically.
      if (!inEditor && (/\/editor\//.test(spec) || /whiteboardSync/.test(spec)))
        offenders.push(relative(root, file));
    }
  }
  expect(offenders).toEqual([]);
});
