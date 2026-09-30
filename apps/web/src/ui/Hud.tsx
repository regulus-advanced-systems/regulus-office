/**
 * HUD layered over the office canvas: top bar, floor work counters, status box, elevator,
 * lobby chat, corner buttons for settings and shortcut help, dialogs and toasts.
 * The container ignores pointer events so the scene stays clickable
 * between panels.
 */
import { useUiStore } from "../state/ui.ts";
import { AgentHost } from "./agent/AgentHost.tsx";
import { ChatPanel } from "./chat/ChatPanel.tsx";
import { Button } from "./components/Button.tsx";
import { GearIcon, QuestionIcon } from "./components/icons.tsx";
import { Modal } from "./components/Modal.tsx";
import { AddFloorDialogHost } from "./floors/AddFloorDialog.tsx";
import { FloorSettingsDialogHost } from "./floors/FloorSettingsDialog.tsx";
import { HotkeyList } from "./hotkeys/HotkeyHelp.tsx";
import { useGlobalHotkeys } from "./hotkeys/useHotkeys.ts";
import { ElevatorPanel } from "./hud/ElevatorPanel.tsx";
import { StatusBox } from "./hud/StatusBox.tsx";
import { TopBar } from "./hud/TopBar.tsx";
import { WorkCounters } from "./hud/WorkCounters.tsx";
import { NotificationsHost } from "./notifications/NotificationsHost.tsx";
import { ProvidersPanelHost } from "./providers/ProvidersPanel.tsx";
import { SettingsForm } from "./settings/SettingsPanel.tsx";
import { SpawnDialogHost } from "./spawn/SpawnDialog.tsx";
import { TerminalModalHost } from "./terminal/TerminalModal.tsx";
import { Toaster } from "./toast/Toaster.tsx";

export function HudDialogs() {
  const overlay = useUiStore((s) => s.overlay);
  const close = useUiStore((s) => s.closeOverlay);
  return (
    <>
      <Modal
        open={overlay === "settings"}
        onClose={() => close("settings")}
        title="Settings"
        width={460}
        footer={
          <Button variant="primary" onClick={() => close("settings")}>
            Done
          </Button>
        }
      >
        <SettingsForm />
      </Modal>
      <Modal
        open={overlay === "help"}
        onClose={() => close("help")}
        title="Keyboard shortcuts"
        width={460}
      >
        <HotkeyList />
      </Modal>
      <AddFloorDialogHost />
      <FloorSettingsDialogHost />
      <ProvidersPanelHost />
      <SpawnDialogHost />
      <TerminalModalHost />
    </>
  );
}

export function Hud() {
  useGlobalHotkeys();
  const openOverlay = useUiStore((s) => s.openOverlay);
  return (
    <div className="rg-hud">
      <TopBar />
      <WorkCounters />
      <StatusBox />
      <div className="rg-hud__left">
        <ElevatorPanel />
      </div>
      <ChatPanel />
      <div className="rg-hud__corner">
        <Button
          variant="secondary"
          icon={<GearIcon />}
          aria-haspopup="dialog"
          onClick={() => openOverlay("settings")}
        >
          Settings
        </Button>
        <Button
          variant="secondary"
          icon={<QuestionIcon />}
          aria-haspopup="dialog"
          onClick={() => openOverlay("help")}
          title="Keyboard shortcuts (?)"
        >
          Help
        </Button>
      </div>
      <HudDialogs />
      <AgentHost />
      <NotificationsHost />
      <Toaster />
    </div>
  );
}
