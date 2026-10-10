/**
 * The command palette's two ends on the stores (#261): `gatherSources` reads
 * what this browser holds for its viewer (once, when the palette opens), and
 * `runPaletteAction` does what a picked entry says, through the same calls the
 * HUD and the scene already make (quick travel, "who's where", `E` at a desk,
 * the boards, the queue clipboard, Settings). Each of those keeps its own
 * check, and the server checks whatever reaches it.
 */
import { EMPTY_COMPOUND, type OperationState } from "@regulus/protocol";
import { useBuildingStore } from "../../state/building.ts";
import { useCompoundStore } from "../../state/compound.ts";
import { useLevelStore } from "../../state/level.ts";
import { useAgentChatWindow } from "../../state/officeAgents.ts";
import { useOperationStore } from "../../state/operation.ts";
import { useOperationsStore } from "../../state/operations.ts";
import { useRoomsStore } from "../../state/rooms.ts";
import { useSessionStore } from "../../state/session.ts";
import { useSpawnStore } from "../../state/spawn.ts";
import { travelTo, travelToLevel } from "../../state/travel.ts";
import { useUiStore } from "../../state/ui.ts";
import { walkToTeammate } from "../../state/walkToTeammate.ts";
import { useBoardStore } from "../boards/boardStore.ts";
import { ADD_OPERATION_OVERLAY } from "../build-mode/returnDraft.ts";
import { travelGroups } from "../hud/QuickTravel.tsx";
import { useQueueStore } from "../queue/queueStore.ts";
import { SEARCH_OVERLAY_ID, useSearchStore } from "../search/searchStore.ts";
import { openSettingsAt } from "../settings/settingsTabs.ts";
import { useTerminalModal } from "../terminal/terminalStore.ts";
import { whereaboutsRows } from "../whereabouts/whereabouts.ts";
import type { PaletteAction, PaletteSources } from "./entries.ts";

export function gatherSources(): PaletteSources {
  const building = useBuildingStore.getState();
  const world = useCompoundStore.getState().world;
  const operations = useOperationsStore.getState().operations;
  const operation = useOperationStore.getState();
  const user = useSessionStore.getState().user;
  const published = building.state?.levels;
  const summaries = building.state?.operations;
  const rooms: Record<string, OperationState> = { ...useRoomsStore.getState().states };
  if (operation.state) rooms[operation.state.operationId] = operation.state;
  return {
    // Exactly what quick travel lists (QuickTravelDialog).
    travel: travelGroups(
      world,
      published && summaries
        ? { compound: EMPTY_COMPOUND, levels: published, operations: summaries }
        : null,
      useLevelStore.getState().levelId,
      operations ? new Set(operations.map((o) => o.operationId)) : null,
    ),
    people: whereaboutsRows(building.state, world, building.sessionId),
    rooms,
    currentOperationId: operation.state?.operationId ?? null,
    operations,
    viewer: user ? { id: user.id, role: user.role } : null,
    agents: Object.values(building.state?.officeAgents ?? {}),
  };
}

const toastError = (message: string) => useUiStore.getState().toast({ kind: "error", message });
const toastInfo = (message: string) => useUiStore.getState().toast({ kind: "info", message });

export function runPaletteAction(action: PaletteAction, now: () => number = Date.now): void {
  switch (action.kind) {
    case "level":
      if (!travelToLevel(action.levelId)) toastError("Could not go to that level.");
      return;
    case "room":
      if (!travelTo(action.roomId, action.levelId ? { levelId: action.levelId } : {}))
        toastError("Could not go to that room.");
      return;
    case "person": {
      const result = walkToTeammate(action.sessionId);
      if (result === "door") toastInfo(`${action.name} is behind a door: walking to it.`);
      else if (result === "here") toastInfo(`You are already next to ${action.name}.`);
      else if (result === "unreachable") toastError(`No way to ${action.name} from here.`);
      else if (result === "unknown") toastError(`${action.name} is not in the office any more.`);
      return;
    }
    case "henchman": {
      const here = useOperationStore.getState().state;
      // In the room the player is in, a terminal opens at once, as a click on its laptop does.
      if (action.terminal && here?.operationId === action.operationId) {
        if (here.henchmen[action.agentId]) useTerminalModal.getState().openTerminal(action.agentId);
        else toastError("That henchman is gone.");
        return;
      }
      // Otherwise the search jump (#41): into its room, to its desk, then (maybe) its terminal.
      useSearchStore.getState().startJump({
        agentId: action.agentId,
        operationId: action.operationId,
        seatId: action.seatId,
        docId: null,
        query: "",
        startedAt: now(),
        walkOnly: !action.terminal,
      });
      return;
    }
    case "agentChat":
      useAgentChatWindow.getState().open(action.agentId);
      return;
    case "card":
      useBoardStore.getState().openBoard(action.card, action.key);
      return;
    case "settings":
      openSettingsAt(action.tab);
      return;
    case "spawn":
      useSpawnStore.getState().openSpawn(action.seatId);
      return;
    case "queueAdd":
      useQueueStore.getState().openAdd();
      return;
    case "queuePanel":
      useQueueStore.getState().openPanel();
      return;
    case "addOperation":
      useUiStore.getState().openOverlay(ADD_OPERATION_OVERLAY);
      return;
    case "help":
      useUiStore.getState().openOverlay("help");
      return;
    case "search":
      useSearchStore.getState().setQuery(action.query);
      useUiStore.getState().openOverlay(SEARCH_OVERLAY_ID);
      return;
  }
}
