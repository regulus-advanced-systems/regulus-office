/**
 * The human's own login terminal (`/ws/term/login-<id>`, control mode): the
 * unmodified CLI's sign-in in their runner. Only they can open it (the server
 * refuses everyone else). Keys typed here go to the terminal, not the dialog.
 */
import { useEffect, useState } from "react";
import { defaultTerminalDeps, type TerminalDeps } from "../terminal/host.ts";
import { PANEL_PRIORITY, usePanelBudget } from "../terminal/panelBudget.ts";
import { useTerminal } from "../terminal/useTerminal.ts";
import "../terminal/terminal.css";

const PANEL_ID = "provider-login";

export function LoginTerminal({
  terminalId,
  deps = defaultTerminalDeps,
}: {
  terminalId: string;
  deps?: TerminalDeps;
}) {
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const request = usePanelBudget((s) => s.request);
  const release = usePanelBudget((s) => s.release);
  const granted = usePanelBudget((s) => s.granted.has(PANEL_ID));
  useEffect(() => {
    request(PANEL_ID, PANEL_PRIORITY.modal);
    return () => release(PANEL_ID);
  }, [request, release]);

  const { state } = useTerminal({
    agentId: terminalId,
    mode: "control",
    element: granted ? element : null,
    deps,
    autoFocus: true,
  });

  useEffect(() => {
    if (!element) return;
    const stop = (event: KeyboardEvent) => event.stopPropagation();
    element.addEventListener("keydown", stop);
    return () => element.removeEventListener("keydown", stop);
  }, [element]);

  return (
    <div
      className="rg-term__screen rg-providers__term"
      data-testid="login-terminal"
      data-status={state.status}
    >
      <div className="rg-term__xterm" ref={setElement} />
      {!granted && <p className="rg-term__overlay">Too many live terminals open.</p>}
      {granted && state.status !== "open" && (
        <p className="rg-term__overlay" role="status">
          {state.notice ?? (state.status === "connecting" ? "Connecting…" : "Reconnecting…")}
        </p>
      )}
    </div>
  );
}
