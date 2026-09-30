/**
 * The dark terminal box shared by the robot's terminal modal and the login
 * terminal: the xterm element, the connecting / ended overlays, the "Copied"
 * flash, the right-click menu (Copy, Paste) and a one-line help (#156).
 */
import { type CSSProperties, useEffect, useRef } from "react";
import type { TerminalHost } from "./host.ts";
import type { TerminalUiState } from "./terminalState.ts";
import { type ClipboardDeps, useTerminalClipboard } from "./useTerminalClipboard.ts";

export interface TerminalScreenProps {
  state: TerminalUiState;
  host: TerminalHost | null;
  element: HTMLElement | null;
  setElement: (element: HTMLDivElement | null) => void;
  /** The panel budget granted a live slot. */
  granted: boolean;
  className?: string;
  style?: CSSProperties;
  testId: string;
  clipboardDeps?: ClipboardDeps;
}

export function TerminalScreen({
  state,
  host,
  element,
  setElement,
  granted,
  className,
  style,
  testId,
  clipboardDeps,
}: TerminalScreenProps) {
  const readOnly = state.mode !== "control";
  const clip = useTerminalClipboard(element, host, readOnly, clipboardDeps);
  const paste = clip.mac ? "Cmd+V" : "Ctrl+Shift+V";
  const copyKey = clip.mac ? "Cmd+C" : "Ctrl+Shift+C";
  return (
    <>
      <div
        className={`rg-term__screen ${className ?? ""}`}
        data-testid={testId}
        data-status={state.status}
        style={style}
      >
        <div className="rg-term__xterm" ref={setElement} />
        {!granted && <p className="rg-term__overlay">Too many live terminals open.</p>}
        {granted && state.status !== "open" && (
          <p className="rg-term__overlay" role="status">
            {state.notice ?? (state.status === "connecting" ? "Connecting…" : "Reconnecting…")}
          </p>
        )}
        {clip.flash && (
          <span className="rg-term__flash" role="status" data-testid="terminal-flash">
            {clip.flash}
          </span>
        )}
        {clip.menu && (
          <TerminalMenu
            x={clip.menu.x}
            y={clip.menu.y}
            canCopy={clip.menu.selection !== ""}
            canPaste={!readOnly}
            onCopy={() => void clip.copy(clip.menu?.selection ?? "")}
            onPaste={() => void clip.pasteFromClipboard()}
            onClose={clip.closeMenu}
          />
        )}
      </div>
      <p className="rg-term__help" data-testid="terminal-help">
        Select text to copy it ({copyKey} copies too).{" "}
        {readOnly ? "" : `${paste} or right-click to paste. `}Click a link to open it.
      </p>
    </>
  );
}

function TerminalMenu({
  x,
  y,
  canCopy,
  canPaste,
  onCopy,
  onPaste,
  onClose,
}: {
  x: number;
  y: number;
  canCopy: boolean;
  canPaste: boolean;
  onCopy: () => void;
  onPaste: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const menu = ref.current;
    menu?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    const onDown = (event: MouseEvent) => {
      if (!menu?.contains(event.target as Node)) onClose();
    };
    // Native, so it runs before the dialog's own Escape handler: Escape closes only the menu.
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onClose();
    };
    document.addEventListener("mousedown", onDown, true);
    menu?.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown, true);
      menu?.removeEventListener("keydown", onKey);
    };
  }, [onClose]);
  const run = (action: () => void) => () => {
    onClose();
    action();
  };
  return (
    <div
      ref={ref}
      className="rg-term__menu"
      role="menu"
      data-testid="terminal-menu"
      style={{ left: x, top: y }}
    >
      <button type="button" role="menuitem" disabled={!canCopy} onClick={run(onCopy)}>
        Copy
      </button>
      {canPaste && (
        <button type="button" role="menuitem" onClick={run(onPaste)}>
          Paste
        </button>
      )}
    </div>
  );
}
