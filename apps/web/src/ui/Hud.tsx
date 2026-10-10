/**
 * HUD layered over the office canvas: top bar, operation work counters, status box, rooms panel,
 * lobby chat, the jukebox strip and panel (#47), who's where and the emote wheel (#49),
 * voice and the lounge TV (#48),
 * corner buttons for settings and shortcut help, build mode and room settings
 * (docked bottom right, #187), dialogs and toasts.
 * The container ignores pointer events so the scene stays clickable
 * between panels.
 */
import { useUiStore } from "../state/ui.ts";
import { GitHubLinkPrompt } from "./access/GitHubLinkPrompt.tsx";
import { AgentHost } from "./agent/AgentHost.tsx";
import { BoardsHost } from "./boards/BoardsHost.tsx";
import { BookshelfHost } from "./bookshelf/BookshelfHost.tsx";
import { BuildModeHost } from "./build-mode/BuildModeHost.tsx";
import { ChatPanel } from "./chat/ChatPanel.tsx";
import { Button } from "./components/Button.tsx";
import { GearIcon, QuestionIcon } from "./components/icons.tsx";
import { Modal } from "./components/Modal.tsx";
import { EmoteWheel } from "./emotes/EmoteWheel.tsx";
import { HotkeyList } from "./hotkeys/HotkeyHelp.tsx";
import { useGlobalHotkeys } from "./hotkeys/useHotkeys.ts";
import { QuickTravelDialog, useQuickTravelHotkey } from "./hud/QuickTravel.tsx";
import { RoomsPanel } from "./hud/RoomsPanel.tsx";
import { StatusBox } from "./hud/StatusBox.tsx";
import { TopBar } from "./hud/TopBar.tsx";
import { WorkCounters } from "./hud/WorkCounters.tsx";
import { JukeboxHost, JukeboxStrip } from "./jukebox/JukeboxHost.tsx";
import { LiftPanel } from "./lift/LiftPanel.tsx";
import { LiftRide } from "./lift/LiftRide.tsx";
import { MediaHost } from "./media/MediaHost.tsx";
import { MediaStrip } from "./media/MediaStrip.tsx";
import { MeetingHost } from "./meetings/MeetingHost.tsx";
import { NotificationsHost } from "./notifications/NotificationsHost.tsx";
import { AgentChatWindowHost } from "./office-agents/AgentChatWindow.tsx";
import { AddOperationDialogHost } from "./operations/AddOperationDialog.tsx";
import { OperationSettingsDialogHost } from "./operations/OperationSettingsDialog.tsx";
import { PictureDock } from "./pictures/PicturesHost.tsx";
import { ProvidersPanelHost } from "./providers/ProvidersPanel.tsx";
import { QueueHost } from "./queue/QueueHost.tsx";
import { RoomSettingsDock } from "./room-settings/RoomSettingsDock.tsx";
import { SearchHost } from "./search/SearchHost.tsx";
import { RunningApps } from "./services/RunningApps.tsx";
import { SettingsForm } from "./settings/SettingsPanel.tsx";
import { SpawnDialogHost } from "./spawn/SpawnDialog.tsx";
import { TerminalModalHost } from "./terminal/TerminalModal.tsx";
import { Toaster } from "./toast/Toaster.tsx";
import { useMyUsagePolling } from "./usage/usageStore.ts";
import { useDoingSync } from "./whereabouts/useDoingSync.ts";
import { WhereaboutsPanel } from "./whereabouts/WhereaboutsPanel.tsx";
import { WhiteboardHost } from "./whiteboard/WhiteboardHost.tsx";
import { WorkflowsPanelHost } from "./workflows/WorkflowsPanel.tsx";

export function HudDialogs() {
  const overlay = useUiStore((s) => s.overlay);
  const close = useUiStore((s) => s.closeOverlay);
  return (
    <>
      <Modal
        open={overlay === "settings"}
        onClose={() => close("settings")}
        title="Settings"
        width={880}
        className="rg-modal--settings"
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
      <AddOperationDialogHost />
      <OperationSettingsDialogHost />
      <ProvidersPanelHost />
      <WorkflowsPanelHost />
      <SpawnDialogHost />
      <TerminalModalHost />
      <SearchHost />
      <QuickTravelDialog />
      <LiftPanel />
    </>
  );
}

export function Hud() {
  useGlobalHotkeys();
  useQuickTravelHotkey();
  useMyUsagePolling();
  useDoingSync();
  const openOverlay = useUiStore((s) => s.openOverlay);
  return (
    <div className="rg-hud">
      <TopBar />
      <WorkCounters />
      <StatusBox />
      <div className="rg-hud__left">
        <GitHubLinkPrompt />
        <RoomsPanel />
        <WhereaboutsPanel />
        <RunningApps />
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
        <JukeboxStrip />
        <MediaStrip />
      </div>
      <BuildModeHost />
      <RoomSettingsDock />
      <PictureDock />
      <HudDialogs />
      <AgentHost />
      <BoardsHost />
      <QueueHost />
      <BookshelfHost />
      <MeetingHost />
      <JukeboxHost />
      <MediaHost />
      <WhiteboardHost />
      <NotificationsHost />
      <AgentChatWindowHost />
      <EmoteWheel />
      <LiftRide />
      <Toaster />
    </div>
  );
}
