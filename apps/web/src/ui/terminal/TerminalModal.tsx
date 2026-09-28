/**
 * Live terminal modal (SPEC §9.4, §6 channel 3, D12): the robot's tmux
 * session in xterm.js, a watch/control indicator, "Take control" only for
 * those allowed (robot owner, office owner/admin), viewer faces, "X is
 * typing", reconnect status. Counts as one of the ≤ 2 live DOM panels.
 *
 * While in control, every key (Escape and Tab included) goes to the
 * terminal; the close button and "Release control" stay clickable.
 */
import type { TerminalMode } from "@regulus/protocol";
import { useEffect, useState } from "react";
import { useFloorStore } from "../../state/floor.ts";
import { useSessionStore } from "../../state/session.ts";
import { useUiStore } from "../../state/ui.ts";
import { Button } from "../components/Button.tsx";
import { Modal } from "../components/Modal.tsx";
import { mayControlTerminal } from "./access.ts";
import { defaultTerminalDeps, type TerminalDeps } from "./host.ts";
import { PANEL_PRIORITY, usePanelBudget } from "./panelBudget.ts";
import { TerminalPeople } from "./TerminalPeople.tsx";
import { useTerminalModal } from "./terminalStore.ts";
import { useTerminal } from "./useTerminal.ts";
import "./terminal.css";

export const TERMINAL_OVERLAY_ID = "terminal";
export const MODAL_PANEL_ID = "terminal-modal";

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
  const robot = useFloorStore((s) => s.state?.robots[agentId]);
  const canControl = mayControlTerminal(user, robot?.ownerUserId);
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

  const { state } = useTerminal({
    agentId,
    mode,
    element: granted ? element : null,
    deps,
    autoFocus: true,
    onDowngrade: () => setMode("watch"),
  });
  const inControl = state.mode === "control";

  // Keys typed into the terminal must not reach the dialog's Escape/Tab handling.
  useEffect(() => {
    if (!element || !inControl) return;
    const stop = (event: KeyboardEvent) => event.stopPropagation();
    element.addEventListener("keydown", stop);
    return () => element.removeEventListener("keydown", stop);
  }, [element, inControl]);

  const title = robot
    ? `${robot.ownerName}'s robot: ${robot.taskTitle || robot.model}`
    : "Terminal";
  return (
    <Modal open onClose={onClose} title={title} width={1040} dismissOnBackdrop={false}>
      <div className="rg-term" data-testid="terminal-modal">
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
          <TerminalPeople
            viewers={state.viewers}
            peers={state.peers}
            selfId={user?.id}
            typing={state.typing}
          />
        </div>
        <div className="rg-term__screen" data-testid="terminal-screen" data-status={state.status}>
          <div className="rg-term__xterm" ref={setElement} />
          {!granted && <p className="rg-term__overlay">Too many live terminals open.</p>}
          {granted && state.status !== "open" && (
            <p className="rg-term__overlay" role="status">
              {state.notice ?? (state.status === "connecting" ? "Connecting…" : "Reconnecting…")}
            </p>
          )}
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
