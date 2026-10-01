/**
 * "Connect providers" (SPEC §7 login column, §8, D2), opened from Settings
 * and from the spawn dialog when the chosen provider is not connected
 * (`openProvidersPanel(provider)`). Subscriptions sign in through the
 * provider's own CLI in the human's runner; API and plan keys are pasted
 * once and stored encrypted.
 */
import { useSessionStore } from "../../state/session.ts";
import { useUiStore } from "../../state/ui.ts";
import { Button } from "../components/Button.tsx";
import { Modal } from "../components/Modal.tsx";
import { useTerminalExpanded, useViewportSize } from "../terminal/expand.ts";
import type { TerminalDeps } from "../terminal/host.ts";
import { createProvidersApi, type ProvidersApi } from "./api.ts";
import { CliLogins } from "./CliLogins.tsx";
import { KeyProfiles } from "./KeyProfiles.tsx";
import { providersPanelWidth } from "./loginLayout.ts";
import { closeProvidersPanel, PROVIDERS_OVERLAY, useProvidersPanel } from "./providersStore.ts";
import "./providers.css";

const defaultApi = createProvidersApi();

export interface ProvidersPanelProps {
  api?: ProvidersApi;
  pollMs?: number;
  terminalDeps?: TerminalDeps;
}

export function ProvidersPanelHost({
  api = defaultApi,
  pollMs,
  terminalDeps,
}: ProvidersPanelProps) {
  const open = useUiStore((s) => s.overlay === PROVIDERS_OVERLAY);
  const focus = useProvidersPanel((s) => s.focus);
  const role = useSessionStore((s) => s.user?.role);
  // An expanded login terminal widens the whole panel (#156).
  const [expanded] = useTerminalExpanded();
  const loginTerminal = useProvidersPanel((s) => s.loginTerminals > 0);
  const viewport = useViewportSize();
  if (!open) return null;
  return (
    <Modal
      open
      onClose={closeProvidersPanel}
      title="Connect providers"
      width={providersPanelWidth(viewport, expanded && loginTerminal)}
      dismissOnBackdrop={false}
      footer={
        <Button variant="primary" onClick={closeProvidersPanel}>
          Done
        </Button>
      }
    >
      {role === "viewer" ? (
        <p className="rg-muted">
          Viewers watch henchmen and do not run their own, so there is nothing to connect.
        </p>
      ) : (
        <div className="rg-providers" data-testid="providers-panel">
          <CliLogins api={api} pollMs={pollMs} focus={focus} terminalDeps={terminalDeps} />
          <KeyProfiles api={api} focus={focus} />
        </div>
      )}
    </Modal>
  );
}
