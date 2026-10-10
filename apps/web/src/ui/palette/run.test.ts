import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { OperationState } from "@regulus/protocol";
import { LOBBY_LEVEL_ID } from "@regulus/protocol";
import { henchmanFixture, operationFixture } from "@regulus/protocol/src/fixtures.ts";
import { syncCompoundWorld } from "../../state/compound.ts";
import { useLevelStore } from "../../state/level.ts";
import { useOperationStore } from "../../state/operation.ts";
import { useOperationsStore } from "../../state/operations.ts";
import { useRoomsStore } from "../../state/rooms.ts";
import { useSpawnStore } from "../../state/spawn.ts";
import { useUiStore } from "../../state/ui.ts";
import { useSearchStore } from "../search/searchStore.ts";
import { useSettingsTabStore } from "../settings/settingsTabs.ts";
import { useTerminalModal } from "../terminal/terminalStore.ts";
import { buildEntries } from "./entries.ts";
import { gatherSources, runPaletteAction } from "./run.ts";
import { publish, resetStores } from "./testKit.ts";

const overlay = () => useUiStore.getState().overlay;
const toasts = () => useUiStore.getState().toastQueue.toasts.map((t) => t.message);

beforeEach(resetStores);
afterEach(resetStores);

describe("what the palette reads from the stores (#261)", () => {
  test("the viewer, their rooms and the joined room states; nothing before the office has loaded", () => {
    expect(buildEntries(gatherSources()).map((e) => e.title)).toEqual([
      "Keyboard shortcuts",
      "Settings: You",
      "Settings: Agents",
      "Settings: Notifications",
      "Settings: Display and sound",
    ]);
    publish();
    const apollo = { ...operationFixture, operationId: "apollo", name: "Apollo" } as OperationState;
    // A nearby room this client has joined, and one whose state lingers without access to it.
    useRoomsStore.getState().apply("apollo", apollo);
    useRoomsStore.getState().apply("vault", { ...apollo, operationId: "vault", name: "Vault" });
    const src = gatherSources();
    expect(src.viewer).toEqual({ id: "mia", role: "member" });
    expect(src.currentOperationId).toBeNull();
    expect(src.travel.map((g) => g.rooms.map((r) => r.id))).toEqual([
      ["lobby", "conference", "break_room"],
      ["landing", "apollo"],
    ]);
    const entries = buildEntries(src);
    expect(entries.filter((e) => e.group === "Henchman").map((e) => e.hint)).toEqual([
      "Ante's · Apollo · working",
      "Ante's · Apollo · working",
    ]);
    expect(JSON.stringify(entries)).not.toContain("Vault");
    // The room the player is in is the one whose boards and desks are offered.
    useOperationStore.getState().apply(apollo);
    expect(gatherSources().currentOperationId).toBe("apollo");
    expect(buildEntries(gatherSources()).some((e) => e.action.kind === "spawn")).toBe(true);
  });
});

describe("what a picked entry does (#261)", () => {
  test("a level and a room: quick travel's own calls, which refuse what is not the viewer's", () => {
    publish();
    runPaletteAction({ kind: "level", levelId: "lv-octo" });
    expect(useLevelStore.getState().levelId).toBe("lv-octo");
    runPaletteAction({ kind: "room", roomId: "lobby", levelId: LOBBY_LEVEL_ID });
    expect(useLevelStore.getState().levelId).toBe(LOBBY_LEVEL_ID);
    expect(toasts()).toEqual([]);
    // A room that is not this viewer's to enter: refused by travelTo, said in a toast.
    useOperationsStore.setState({ operations: [] });
    syncCompoundWorld();
    runPaletteAction({ kind: "room", roomId: "apollo", levelId: "lv-octo" });
    expect(toasts()).toEqual(["Could not go to that room."]);
    runPaletteAction({ kind: "level", levelId: "lv-nowhere" });
    expect(toasts()).toContain("Could not go to that level.");
  });

  test("a henchman's terminal opens at once in the room one is in; elsewhere the jump goes there first", () => {
    const state = { ...operationFixture, operationId: "f1" } as OperationState;
    useOperationStore.getState().apply(state);
    const target = { agentId: "a1", operationId: "f1", seatId: henchmanFixture.seatId };
    runPaletteAction({ kind: "henchman", ...target, terminal: true });
    expect(useTerminalModal.getState().agentId).toBe("a1");
    expect(useSearchStore.getState().jump).toBeNull();

    useTerminalModal.getState().closeTerminal();
    runPaletteAction({ kind: "henchman", ...target, terminal: false }, () => 42);
    expect(useTerminalModal.getState().agentId).toBeNull();
    expect(useSearchStore.getState().jump).toEqual({
      ...target,
      docId: null,
      query: "",
      startedAt: 42,
      walkOnly: true,
    });

    useOperationStore.getState().clear();
    runPaletteAction({ kind: "henchman", ...target, terminal: true }, () => 43);
    expect(useTerminalModal.getState().agentId).toBeNull();
    expect(useSearchStore.getState().jump).toMatchObject({ walkOnly: false, startedAt: 43 });
  });

  test("someone who has left: said, nothing else happens", () => {
    publish();
    runPaletteAction({ kind: "person", sessionId: "gone", name: "Olga" });
    expect(toasts()).toEqual(["Olga is not in the office any more."]);
  });

  test("Settings tabs, the spawn dialog, help and search", () => {
    runPaletteAction({ kind: "settings", tab: "notifications" });
    expect(overlay()).toBe("settings");
    expect(useSettingsTabStore.getState().tab).toBe("notifications");
    runPaletteAction({ kind: "spawn", seatId: "seat-2" });
    expect(useSpawnStore.getState().request).toEqual({ seatId: "seat-2" });
    runPaletteAction({ kind: "help" });
    expect(overlay()).toBe("help");
    runPaletteAction({ kind: "search", query: "needle" });
    expect(overlay()).toBe("search");
    expect(useSearchStore.getState().query).toBe("needle");
  });
});
