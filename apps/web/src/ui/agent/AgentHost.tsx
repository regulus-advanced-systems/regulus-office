/**
 * Mounted once in the HUD: the robot panel, the permission prompt, the
 * send-home and PR dialogs, the changes window (#38), and the sync of the FloorRoom's robot messages
 * into the agent store (a robot sent home starts its walk to the elevator).
 */
import { getOfficeClient } from "../../net/index.ts";
import { startSendHome } from "../../scene/robots/sendHome/controller.ts";
import { selectReducedMotion, useUiStore } from "../../state/ui.ts";
import { ChangesWindowHost } from "../changes/ChangesWindow.tsx";
import { AgentPanel } from "./AgentPanel.tsx";
import { type AgentSyncDeps, useAgentSync } from "./agentSync.ts";
import { PermissionDialog } from "./PermissionDialog.tsx";
import { PullRequestDialog } from "./PullRequestDialog.tsx";
import { SendHomeDialog } from "./SendHomeDialog.tsx";
import "../auth/auth.css";
import "./agent.css";

const liveDeps = (): AgentSyncDeps => ({
  client: getOfficeClient(),
  onLeaving: (agentId) =>
    startSendHome(agentId, { reducedMotion: selectReducedMotion(useUiStore.getState()) }),
});

export function AgentHost({ deps = liveDeps }: { deps?: () => AgentSyncDeps }) {
  useAgentSync(deps);
  return (
    <>
      <AgentPanel />
      <PermissionDialog />
      <SendHomeDialog />
      <PullRequestDialog />
      <ChangesWindowHost />
    </>
  );
}
