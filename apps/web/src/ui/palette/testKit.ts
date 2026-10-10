/** A small lair in the stores for the palette's tests, and the way back. Only imported by tests. */
import type { BuildingState, LevelState, OperationInfo } from "@regulus/protocol";
import { LOBBY_LEVEL_ID } from "@regulus/protocol";
import { rowPlacement, testState } from "../../scene/compound/testing.ts";
import { useBuildingStore } from "../../state/building.ts";
import { syncCompoundWorld, useCompoundStore } from "../../state/compound.ts";
import { useLevelStore } from "../../state/level.ts";
import { useOperationStore } from "../../state/operation.ts";
import { useOperationsStore } from "../../state/operations.ts";
import { usePlayerStore } from "../../state/player.ts";
import { useRoomsStore } from "../../state/rooms.ts";
import { useSessionStore } from "../../state/session.ts";
import { useSpawnStore } from "../../state/spawn.ts";
import { useUiStore } from "../../state/ui.ts";
import { useSearchStore } from "../search/searchStore.ts";
import { useTerminalModal } from "../terminal/terminalStore.ts";

const lobby = testState([]);
const octo = testState([{ id: "apollo", name: "Apollo", placement: rowPlacement(4) }], 48, {
  levelId: "lv-octo",
  landing: true,
});
const LEVELS: LevelState[] = [
  {
    levelId: LOBBY_LEVEL_ID,
    kind: "lobby",
    login: "",
    name: "Lobby",
    order: 0,
    compound: lobby.compound,
  },
  {
    levelId: "lv-octo",
    kind: "org",
    login: "octo-org",
    name: "Octo Org",
    order: 1,
    compound: octo.compound,
  },
];

/**
 * A lair of two levels with Apollo on the second, a member called Mia standing in the
 * lobby; `mine` are the rooms she may enter (and work in).
 */
export function publish(mine: readonly string[] = ["apollo"]): void {
  useBuildingStore.setState({
    state: {
      compound: lobby.compound,
      levels: Object.fromEntries(LEVELS.map((l) => [l.levelId, l])),
      operations: { ...lobby.operations, ...octo.operations },
      humans: {},
      officeAgents: {},
    } as unknown as BuildingState,
    sessionId: "me",
  });
  useOperationsStore.setState({
    operations: mine.map((operationId) => ({ operationId, access: "spawn" }) as OperationInfo),
  });
  useSessionStore.setState({ user: { id: "mia", displayName: "Mia", role: "member" } });
  syncCompoundWorld();
  usePlayerStore.getState().spawnAt({ x: 5, z: 5, heading: 0 }, "compound");
}

export function resetStores(): void {
  useUiStore.getState().closeOverlay();
  useUiStore.getState().clearToasts();
  useLevelStore.setState({ levelId: LOBBY_LEVEL_ID });
  useBuildingStore.getState().clear();
  useOperationsStore.setState({ operations: null });
  useOperationStore.getState().clear();
  useRoomsStore.getState().clear();
  useCompoundStore.setState({ world: null });
  usePlayerStore.getState().reset();
  useSessionStore.setState({ user: null });
  useSearchStore.setState({ query: "", status: "idle", result: null, jump: null, reveal: null });
  useTerminalModal.getState().closeTerminal();
  useSpawnStore.getState().closeSpawn();
}
