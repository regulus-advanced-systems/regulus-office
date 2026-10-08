import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { BuildingState, LevelState, OperationInfo } from "@regulus/protocol";
import { HOLDING_LEVEL_ID, LOBBY_LEVEL_ID } from "@regulus/protocol";
import { act } from "react";
import { rowPlacement, testState } from "../../scene/compound/testing.ts";
import { useBuildingStore } from "../../state/building.ts";
import { syncCompoundWorld, useCompoundStore } from "../../state/compound.ts";
import { levelList, useLevelStore } from "../../state/level.ts";
import { LIFT_OVERLAY, useLiftStore } from "../../state/lift.ts";
import { useOperationsStore } from "../../state/operations.ts";
import { usePlayerStore } from "../../state/player.ts";
import { useUiStore } from "../../state/ui.ts";
import { click, type Mounted, mount, press, useDom } from "../a11y/dom.ts";
import { settle, text } from "../auth/testDom.tsx";
import { LevelAvatar, levelAvatarUrl, levelMonogram } from "./LevelAvatar.tsx";
import { LiftPanel, liftRows } from "./LiftPanel.tsx";
import { LiftRide } from "./LiftRide.tsx";

useDom();

const lobby = testState([]);
const landing = (levelId: string, id: string) =>
  testState([{ id, placement: rowPlacement(4) }], 48, { levelId, landing: true });
const octo = landing("lv-octo", "apollo");
const ada = landing("lv-ada", "zeus");
const scratch = landing(HOLDING_LEVEL_ID, "scratch");
const LEVELS: LevelState[] = [
  {
    levelId: "lv-ada",
    kind: "account",
    login: "ada",
    name: "Ada Lovelace",
    order: 2,
    compound: ada.compound,
  },
  {
    levelId: HOLDING_LEVEL_ID,
    kind: "holding",
    login: "",
    name: "Unassigned",
    order: 65535,
    compound: scratch.compound,
  },
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

function publish(levels = LEVELS) {
  useBuildingStore.setState({
    state: {
      compound: lobby.compound,
      levels: Object.fromEntries(levels.map((l) => [l.levelId, l])),
      operations: {
        ...lobby.operations,
        ...octo.operations,
        ...ada.operations,
        ...scratch.operations,
      },
      humans: {},
    } as unknown as BuildingState,
    sessionId: "me",
  });
  useOperationsStore.setState({
    operations: ["apollo", "zeus", "scratch"].map(
      (operationId) => ({ operationId }) as OperationInfo,
    ),
  });
  syncCompoundWorld();
}

/** Open the lift's panel, as `E` at the lift does. */
async function open() {
  await act(async () => useUiStore.getState().openOverlay(LIFT_OVERLAY));
  await settle();
}

const rowButtons = () => [...document.querySelectorAll<HTMLButtonElement>(".rg-lift__row")];

let mounted: Mounted | null = null;
beforeEach(() => {
  publish();
  usePlayerStore.getState().spawnAt({ x: 5, z: 5, heading: 0 }, "compound");
  // Reduced motion: the level changes at once, with no timers to wait for.
  useUiStore.getState().updateSettings({ reducedMotion: true });
});
afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
  useUiStore.getState().closeOverlay();
  useUiStore.getState().updateSettings({ reducedMotion: null });
  useLiftStore.setState({ ride: null, arrivedAt: null });
  useLevelStore.setState({ levelId: LOBBY_LEVEL_ID });
  useBuildingStore.getState().clear();
  useOperationsStore.setState({ operations: null });
  useCompoundStore.setState({ world: null });
  usePlayerStore.getState().reset();
});

describe("the lift's rows (#269)", () => {
  test("every published level in lift order, with its mark, name and whose it is", () => {
    const rows = liftRows(
      levelList({ levels: Object.fromEntries(LEVELS.map((l) => [l.levelId, l])) }),
      "lv-octo",
    );
    expect(rows.map((r) => [r.label.mark, r.label.title, r.label.caption, r.here])).toEqual([
      ["L", "Lobby level", "Reception, war room, break room, beach", false],
      ["S1", "Octo Org", "Sublevel 1 · GitHub organisation · octo-org", true],
      ["S2", "Ada Lovelace", "Sublevel 2 · GitHub account · ada", false],
      ["S3", "Holding level", "Sublevel 3 · rooms with no repo yet", false],
    ]);
  });

  test("a level the viewer cannot reach is not published, so it is not a row", () => {
    const reachable = LEVELS.filter((l) => l.levelId !== "lv-octo");
    const rows = liftRows(
      levelList({ levels: Object.fromEntries(reachable.map((l) => [l.levelId, l])) }),
      LOBBY_LEVEL_ID,
    );
    expect(rows.map((r) => r.label.title)).toEqual([
      "Lobby level",
      "Ada Lovelace",
      "Holding level",
    ]);
    // Ada's level is now the first below the lobby: no gap where the other one is.
    expect(rows[1]?.label.mark).toBe("S1");
  });
});

describe("level pictures (#269)", () => {
  test("GitHub's avatar for organisations and accounts; none for the lobby and holding levels", () => {
    expect(levelAvatarUrl({ kind: "org", login: "octo-org" })).toBe(
      "https://github.com/octo-org.png?size=96",
    );
    expect(levelAvatarUrl({ kind: "account", login: "ada" }, 40)).toBe(
      "https://github.com/ada.png?size=40",
    );
    expect(levelAvatarUrl({ kind: "account", login: "a/b?c" })).toBe(
      "https://github.com/a%2Fb%3Fc.png?size=96",
    );
    expect(levelAvatarUrl({ kind: "lobby", login: "" })).toBeNull();
    expect(levelAvatarUrl({ kind: "holding", login: "" })).toBeNull();
    expect(levelAvatarUrl({ kind: "org", login: "" })).toBeNull();
  });

  test("a monogram stands in until the picture loads, and when it cannot", async () => {
    expect(levelMonogram("Regulus Advanced Systems")).toBe("RA");
    expect(levelMonogram("octo-org")).toBe("OO");
    expect(levelMonogram("ada")).toBe("AD");
    expect(levelMonogram("")).toBe("?");
    mounted = await mount(
      <LevelAvatar level={{ kind: "org", login: "octo-org", name: "Octo Org" }} />,
    );
    const img = document.querySelector("img");
    expect(img?.getAttribute("src")).toBe("https://github.com/octo-org.png?size=96");
    expect(img?.getAttribute("alt")).toBe("");
    expect(img?.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(text()).toContain("OO");
    await act(async () => {
      img?.dispatchEvent(new Event("error"));
    });
    expect(document.querySelector("img")).toBeNull();
    expect(text()).toContain("OO");
  });
});

describe("the lift's panel (#269)", () => {
  test("lists the reachable levels and nothing about their rooms; the current one is marked", async () => {
    mounted = await mount(<LiftPanel />);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await open();
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.getAttribute("aria-modal")).toBe("true");
    expect(document.querySelector(".rg-modal__title")?.textContent).toBe("Lift");
    expect(rowButtons().map((b) => b.dataset.level)).toEqual([
      LOBBY_LEVEL_ID,
      "lv-octo",
      "lv-ada",
      HOLDING_LEVEL_ID,
    ]);
    expect(rowButtons()[0]?.getAttribute("aria-current")).toBe("true");
    expect(rowButtons()[0]?.textContent).toContain("You are here");
    expect(rowButtons()[1]?.getAttribute("aria-current")).toBeNull();
    // No room names and no counts on the lift.
    for (const word of ["apollo", "zeus", "scratch", "busy", "working"])
      expect(text()).not.toContain(word);
    expect(document.querySelectorAll(".rg-lift__avatar img")).toHaveLength(2);
  });

  test("picking a level closes the panel and arrives there; the level one is on does nothing", async () => {
    mounted = await mount(
      <>
        <LiftPanel />
        <LiftRide />
      </>,
    );
    await open();
    const [here, octoRow] = rowButtons();
    if (!here || !octoRow) throw new Error("no rows");
    await click(here);
    expect(useUiStore.getState().overlay).toBe(LIFT_OVERLAY);
    expect(useLevelStore.getState().levelId).toBe(LOBBY_LEVEL_ID);
    await click(octoRow);
    await settle();
    expect(useUiStore.getState().overlay).toBeNull();
    expect(useLevelStore.getState().levelId).toBe("lv-octo");
    expect(useCompoundStore.getState().world?.rooms.map((r) => r.kind)).toEqual([
      "landing",
      "project",
    ]);
    // Reduced motion: no ride on screen, and the arrival is announced.
    expect(document.querySelector('[data-testid="lift-ride"]')).toBeNull();
    const status = document.querySelector('[data-testid="lift-arrived"]');
    expect(status?.getAttribute("aria-live")).toBe("polite");
    expect(status?.textContent).toBe("The lift arrived: Octo Org.");
  });

  test("Escape closes it; with motion the ride shows the doors and the level it left", async () => {
    mounted = await mount(
      <>
        <LiftPanel />
        <LiftRide />
      </>,
    );
    await open();
    const dialog = document.querySelector('[role="dialog"]');
    if (!dialog) throw new Error("no dialog");
    await press(dialog, "Escape");
    expect(useUiStore.getState().overlay).toBeNull();

    await act(async () => useUiStore.getState().updateSettings({ reducedMotion: false }));
    await open();
    const ada = rowButtons().find((b) => b.dataset.level === "lv-ada");
    if (!ada) throw new Error("no row");
    await click(ada);
    await settle();
    const ride = document.querySelector<HTMLElement>('[data-testid="lift-ride"]');
    expect(ride?.dataset.style).toBe("doors");
    expect(ride?.getAttribute("aria-hidden")).toBe("true");
    expect(ride?.querySelectorAll(".rg-lift-ride__leaf")).toHaveLength(2);
    expect(ride?.querySelector(".rg-lift-ride__mark")?.textContent).toBe("L");
    // The panel stays shut for the length of the ride.
    await open();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  test("with only the lobby level it says there is nowhere to go yet", async () => {
    publish(LEVELS.filter((l) => l.levelId === LOBBY_LEVEL_ID));
    mounted = await mount(<LiftPanel />);
    await open();
    expect(rowButtons()).toHaveLength(1);
    expect(text()).toContain("nowhere else to take you yet");
  });
});
