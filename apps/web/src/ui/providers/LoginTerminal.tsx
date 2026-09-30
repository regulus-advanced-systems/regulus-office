/**
 * The human's own login terminal (`/ws/term/login-<id>`, control mode): the
 * unmodified CLI's sign-in in their runner. Only they can open it (the server
 * refuses everyone else). Keys typed here go to the terminal, not the dialog.
 *
 * #156: the CLI's sign-in link is found in the terminal (in the browser only)
 * and shown above it with Open and Copy; the terminal copies, pastes and
 * opens links, fills its box (tmux reflows to it) and can be expanded.
 */
import type { CliLoginProvider } from "@regulus/protocol";
import { useEffect, useState } from "react";
import { ExpandButton } from "../terminal/ExpandButton.tsx";
import { useTerminalExpanded, useViewportSize } from "../terminal/expand.ts";
import { defaultTerminalDeps, type TerminalDeps } from "../terminal/host.ts";
import { PANEL_PRIORITY, usePanelBudget } from "../terminal/panelBudget.ts";
import { TerminalScreen } from "../terminal/TerminalScreen.tsx";
import { useTerminal } from "../terminal/useTerminal.ts";
import "../terminal/terminal.css";
import { loginTerminalSize } from "./loginLayout.ts";
import { useProvidersPanel } from "./providersStore.ts";
import { SignInLinkBar, useSignInLink } from "./SignInLinkBar.tsx";

const PANEL_ID = "provider-login";

export function LoginTerminal({
  terminalId,
  provider,
  deps = defaultTerminalDeps,
}: {
  terminalId: string;
  provider: CliLoginProvider;
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

  const addLoginTerminal = useProvidersPanel((s) => s.addLoginTerminal);
  useEffect(() => {
    addLoginTerminal(1);
    return () => addLoginTerminal(-1);
  }, [addLoginTerminal]);

  const { state, host } = useTerminal({
    agentId: terminalId,
    mode: "control",
    element: granted ? element : null,
    deps,
    autoFocus: true,
  });
  const link = useSignInLink(host, provider);
  const [expanded, toggleExpanded] = useTerminalExpanded();
  const box = loginTerminalSize(useViewportSize(), expanded);

  useEffect(() => {
    if (!element) return;
    const stop = (event: KeyboardEvent) => event.stopPropagation();
    element.addEventListener("keydown", stop);
    return () => element.removeEventListener("keydown", stop);
  }, [element]);

  // Expanding makes the panel taller than its body: bring the terminal into view.
  useEffect(() => {
    if (expanded)
      element?.closest(".rg-providers__terminal")?.scrollIntoView?.({ block: "nearest" });
  }, [expanded, element]);

  return (
    <div className="rg-providers__terminal" data-expanded={expanded || undefined}>
      <div className="rg-providers__term-bar">
        <SignInLinkBar url={link} />
        <ExpandButton expanded={expanded} onToggle={toggleExpanded} />
      </div>
      <TerminalScreen
        state={state}
        host={host}
        element={element}
        setElement={setElement}
        granted={granted}
        className="rg-providers__term"
        style={{ height: box.height }}
        testId="login-terminal"
      />
    </div>
  );
}
