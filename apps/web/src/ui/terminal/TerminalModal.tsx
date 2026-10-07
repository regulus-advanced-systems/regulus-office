/**
 * Live terminal modal (SPEC §9.4, §6 channel 3, D12): the henchman's tmux
 * session in xterm.js, a watch/control indicator, "Take control" only for
 * the henchman's owner (#138; everyone else, admins included, gets an "only X
 * can control" note), viewer faces, "X is typing", reconnect status. Counts as one of the ≤ 2 live DOM panels.
 *
 * While in control, every key (Escape and Tab included) goes to the
 * terminal; the close button and "Release control" stay clickable.
 *
 * Copy, paste and links work for watchers and controllers alike, and the
 * expand button grows the dialog to about 60 % of the window (#156).
 * When the henchman's CLI asks its owner to sign in, the owner gets the
 * sign-in link bar above the terminal (#158).
 */
import { TERMINAL_DEFAULT_SIZE, type TerminalMode } from "@regulus/protocol";
import { useEffect, useState } from "react";
import { useOperationStore } from "../../state/operation.ts";
import { useSessionStore } from "../../state/session.ts";
import { useUiStore } from "../../state/ui.ts";
import { Button } from "../components/Button.tsx";
import { Modal } from "../components/Modal.tsx";
import { SearchReveal } from "../search/SearchReveal.tsx";
import { mayControlTerminal } from "./access.ts";
import { ExpandButton } from "./ExpandButton.tsx";
import {
  expandedTerminalSize,
  MODAL_CHROME_PX,
  useTerminalExpanded,
  useViewportSize,
} from "./expand.ts";
import { HenchmanSignInLink } from "./HenchmanSignInLink.tsx";
import { defaultTerminalDeps, type TerminalDeps } from "./host.ts";
import { PANEL_PRIORITY, usePanelBudget } from "./panelBudget.ts";
import { TerminalPeople } from "./TerminalPeople.tsx";
import { TerminalScreen } from "./TerminalScreen.tsx";
import { useTerminalModal } from "./terminalStore.ts";
import { useTerminal } from "./useTerminal.ts";
import "./terminal.css";

export const TERMINAL_OVERLAY_ID = "terminal";
export const MODAL_PANEL_ID = "terminal-modal";

/** The dialog at normal size, and its height around the terminal box (title, bar, help). */
export const MODAL_WIDTH = 1040;
const RESERVE_HEIGHT = 190;

export interface TerminalModalProps {
  agentId: string;
  onClose: () => void;
  deps?: TerminalDeps;
}

export function TerminalModal({
  agentId,
  onClose,
  deps = defaultTerminalDeps,
}: TerminalModalProps) {
  const user = useSessionStore((s) => s.user);
  const henchman = useOperationStore((s) => s.state?.henchmen[agentId]);
  const canControl = mayControlTerminal(user, henchman?.ownerUserId);
  const [mode, setMode] = useState<TerminalMode>("watch");
  const [element, setElement] = useState<HTMLDivElement | null>(null);

  const request = usePanelBudget((s) => s.request);
  const release = usePanelBudget((s) => s.release);
  const granted = usePanelBudget((s) => s.granted.has(MODAL_PANEL_ID));
  useEffect(() => {
    request(MODAL_PANEL_ID, PANEL_PRIORITY.modal);
    return () => release(MODAL_PANEL_ID);
  }, [request, release]);

  const openOverlay = useUiStore((s) => s.openOverlay);
  const closeOverlay = useUiStore((s) => s.closeOverlay);
  useEffect(() => {
    openOverlay(TERMINAL_OVERLAY_ID);
    return () => closeOverlay(TERMINAL_OVERLAY_ID);
  }, [openOverlay, closeOverlay]);

  const { state, host } = useTerminal({
    agentId,
    mode,
    element: granted ? element : null,
    deps,
    autoFocus: true,
    onDowngrade: () => setMode("watch"),
    // The agent's window never grows past its default size: watchers see it letterboxed.
    maxGrid: TERMINAL_DEFAULT_SIZE,
  });
  const [expanded, toggleExpanded] = useTerminalExpanded();
  const viewport = useViewportSize();
  const normal = {
    width: MODAL_WIDTH - MODAL_CHROME_PX,
    height: Math.min(Math.round(viewport.height * 0.62), 560),
  };
  const box = expanded ? expandedTerminalSize(viewport, normal, RESERVE_HEIGHT) : normal;
  const inControl = state.mode === "control";

  // Keys typed into the terminal must not reach the dialog's Escape/Tab handling.
  useEffect(() => {
    if (!element || !inControl) return;
    const stop = (event: KeyboardEvent) => event.stopPropagation();
    element.addEventListener("keydown", stop);
    return () => element.removeEventListener("keydown", stop);
  }, [element, inControl]);

  const title = henchman
    ? `${henchman.name ? `${henchman.name}, ` : ""}${henchman.ownerName}'s henchman: ${henchman.taskTitle || henchman.model}`
    : "Terminal";
  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      width={expanded ? box.width + MODAL_CHROME_PX : MODAL_WIDTH}
      dismissOnBackdrop={false}
    >
      <div className="rg-term" data-testid="terminal-modal" data-expanded={expanded || undefined}>
        <div className="rg-term__bar">
          <span
            className={`rg-term__mode rg-term__mode--${inControl ? "control" : "watch"}`}
            data-testid="terminal-mode"
          >
            {inControl ? "In control" : "Watching"}
          </span>
          {canControl && mode === "watch" && state.status === "open" && (
            <Button size="sm" variant="primary" onClick={() => setMode("control")}>
              Take control
            </Button>
          )}
          {mode === "control" && (
            <Button size="sm" onClick={() => setMode("watch")}>
              Release control
            </Button>
          )}
          {!canControl && henchman && (
            <span className="rg-term__watch-only" data-testid="terminal-watch-only">
              Only {henchman.ownerName || "its owner"} can control this henchman
            </span>
          )}
          <TerminalPeople
            viewers={state.viewers}
            peers={state.peers}
            selfId={user?.id}
            typing={state.typing}
          />
          <ExpandButton expanded={expanded} onToggle={toggleExpanded} />
        </div>
        <HenchmanSignInLink
          host={host}
          provider={henchman?.provider}
          isOwner={!!user && user.id === henchman?.ownerUserId}
        />
        <div className="rg-search-reveal-host">
          <TerminalScreen
            state={state}
            host={host}
            element={element}
            setElement={setElement}
            granted={granted}
            style={{ height: box.height }}
            testId="terminal-screen"
          />
          {/* Opened from a search result (#41): the match in the history, over the live view. */}
          <SearchReveal agentId={agentId} />
        </div>
        {state.status === "open" && state.notice && (
          <p className="rg-term__notice" role="status">
            {state.notice}
          </p>
        )}
      </div>
    </Modal>
  );
}

/** Mounted once in the HUD; shows the modal for `useTerminalModal().agentId`. */
export function TerminalModalHost({ deps }: { deps?: TerminalDeps }) {
  const agentId = useTerminalModal((s) => s.agentId);
  const close = useTerminalModal((s) => s.closeTerminal);
  if (!agentId) return null;
  return <TerminalModal key={agentId} agentId={agentId} onClose={close} deps={deps} />;
}
