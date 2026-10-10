import { describe, expect, test } from "bun:test";
import type {
  CompoundState,
  LevelState,
  OfficeAgentBody,
  OperationInfo,
  OperationState,
  OperationSummary,
} from "@regulus/protocol";
import {
  buildingFixture,
  henchmanFixture,
  operationFixture,
} from "@regulus/protocol/src/fixtures.ts";
import { closedRoomOf, rowPlacement, testState } from "../../scene/compound/testing.ts";
import { compoundWorld } from "../../scene/compound/world.ts";
import { levelView } from "../../state/level.ts";
import { travelGroups } from "../hud/QuickTravel.tsx";
import { BEHIND_CLOSED_DOOR, type WhereaboutsRow } from "../whereabouts/whereabouts.ts";
import {
  buildEntries,
  PALETTE_MAX_SHOWN,
  type PaletteEntry,
  type PaletteSources,
  paletteResults,
} from "./entries.ts";

const member = { id: "mia", role: "member" } as const;
const owner = { id: "olga", role: "owner" } as const;
const viewer = { id: "vic", role: "viewer" } as const;

const info = (operationId: string, access: OperationInfo["access"]) =>
  ({ operationId, access }) as OperationInfo;

const EMPTY: PaletteSources = {
  travel: [],
  people: [],
  rooms: {},
  currentOperationId: null,
  operations: [],
  viewer: member,
  agents: [],
};

const titles = (entries: readonly PaletteEntry[], group?: PaletteEntry["group"]) =>
  entries.filter((e) => !group || e.group === group).map((e) => e.title);
/** Everything an entry could show or carry, for "is this named anywhere" checks. */
const everything = (entries: readonly PaletteEntry[]) => JSON.stringify(entries);

/** Octo (apollo) and Acme (zeus enterable, hades seen from outside only, vault closed), as in QuickTravel.test.ts. */
function lair(withVault = true) {
  const spot = rowPlacement(4);
  const octo = testState([{ id: "apollo", name: "Apollo", placement: spot }], 48, {
    landing: true,
  });
  const acme = testState(
    [
      { id: "zeus", name: "Zeus", placement: spot },
      { id: "hades", name: "Hades", placement: rowPlacement(16), working: 3 },
      { id: "vault", name: "Vault", placement: rowPlacement(28), working: 2 },
    ],
    48,
    { landing: true },
  );
  const lobby = testState([]);
  const level = (levelId: string, name: string, order: number, compound: CompoundState) =>
    ({ levelId, kind: "org", login: name.toLowerCase(), name, order, compound }) as LevelState;
  const state = {
    compound: lobby.compound,
    levels: {
      acme: level("acme", "Acme", 2, acme.compound),
      octo: level("octo", "Octo", 1, octo.compound),
      lobby: { ...level("lobby", "Lobby", 0, lobby.compound), kind: "lobby", login: "" },
    },
    operations: {
      ...lobby.operations,
      apollo: { ...octo.operations.apollo, levelId: "octo" },
      zeus: { ...acme.operations.zeus, levelId: "acme" },
      hades: { ...acme.operations.hades, levelId: "acme" },
    },
    closedRooms: withVault
      ? { vault: closedRoomOf({ ...acme.operations.vault, levelId: "acme" } as OperationSummary) }
      : {},
  } as unknown as Parameters<typeof travelGroups>[1];
  const enterable = new Set(["apollo", "zeus"]);
  const here = compoundWorld(levelView(state, "octo"), enterable, "octo");
  return travelGroups(here, state, "octo", enterable);
}

describe("palette entries: levels and rooms (#261, D26)", () => {
  test("the levels the viewer reaches and the rooms they may enter, as quick travel lists them", () => {
    const entries = buildEntries({ ...EMPTY, travel: lair() });
    // The level one is on is not somewhere to go.
    expect(titles(entries, "Level")).toEqual(["Go to Lobby level", "Go to Acme"]);
    expect(titles(entries, "Room")).toEqual([
      "Go to Lift landing",
      "Go to Apollo",
      "Go to Lobby",
      "Go to War room",
      "Go to Break room",
      "Go to Lift landing",
      "Go to Zeus",
    ]);
    const zeus = entries.find((e) => e.title === "Go to Zeus");
    expect(zeus?.hint).toBe("Acme");
    expect(zeus?.action).toEqual({ kind: "room", roomId: "zeus", levelId: "acme" });
    expect(entries.find((e) => e.title === "Go to Acme")?.action).toEqual({
      kind: "level",
      levelId: "acme",
    });
  });

  test("a closed room is not there by name, by id or by count; nor is a room seen only from outside", () => {
    const withVault = buildEntries({ ...EMPTY, travel: lair(true) });
    const without = buildEntries({ ...EMPTY, travel: lair(false) });
    expect(everything(withVault).toLowerCase()).not.toContain("vault");
    expect(everything(withVault).toLowerCase()).not.toContain("hades");
    // Not even as one row more, or as a "no access" row.
    expect(withVault).toEqual(without);
    expect(everything(withVault).toLowerCase()).not.toMatch(/no access|closed|locked/);
  });

  test("a level the viewer cannot reach is not published, so nothing points at it", () => {
    const reachable = lair().filter((g) => g.level?.levelId !== "acme");
    const entries = buildEntries({ ...EMPTY, travel: reachable });
    expect(everything(entries).toLowerCase()).not.toMatch(/acme|zeus/);
  });
});

const room = (patch: Partial<OperationState> = {}): OperationState => ({
  ...operationFixture,
  operationId: "f1",
  name: "Apollo",
  ...patch,
});

describe("palette entries: what is in a room (#261, D34)", () => {
  test("henchmen, issues and PRs of the room the player is in", () => {
    const entries = buildEntries({
      ...EMPTY,
      rooms: { f1: room() },
      currentOperationId: "f1",
      operations: [info("f1", "view")],
    });
    expect(titles(entries, "Henchman")).toEqual(["Walk to Gasket", "Open Gasket's terminal"]);
    expect(entries.find((e) => e.title === "Open Gasket's terminal")).toMatchObject({
      hint: "Ante's · Apollo · working",
      action: { kind: "henchman", agentId: "a1", operationId: "f1", seatId: "seat-1" },
    });
    expect(titles(entries, "Issue")).toEqual(
      Object.values(operationFixture.issues)
        .sort((a, b) => b.number - a.number)
        .map((i) => `#${i.number} ${i.title}`),
    );
    const pull = Object.values(operationFixture.pulls)[0];
    if (pull) {
      expect(entries.find((e) => e.group === "PR")?.action).toEqual({
        kind: "card",
        card: "pr",
        key: `${pull.repoId}#${pull.number}`,
      });
    }
  });

  test("a room state the viewer's own operation list does not cover is not used", () => {
    const stale = { rooms: { f1: room() }, currentOperationId: "f1" };
    for (const operations of [[], null, [info("other", "manage")]]) {
      const entries = buildEntries({ ...EMPTY, ...stale, operations });
      expect(titles(entries, "Henchman")).toEqual([]);
      expect(titles(entries, "Issue")).toEqual([]);
      expect(everything(entries)).not.toMatch(/Gasket|Apollo/);
      expect(entries.some((e) => ["spawn", "queueAdd", "queuePanel"].includes(e.action.kind))).toBe(
        false,
      );
    }
  });

  test("a nearby room: its henchmen, but its boards and queue stay in that room", () => {
    const entries = buildEntries({
      ...EMPTY,
      rooms: { f1: room(), f2: room({ operationId: "f2", name: "Zeus" }) },
      currentOperationId: "f2",
      operations: [info("f1", "manage"), info("f2", "view")],
    });
    // The room the player is in first.
    expect(entries.filter((e) => e.group === "Henchman").map((e) => e.hint)).toEqual([
      "Ante's · Zeus · working",
      "Ante's · Zeus · working",
      "Ante's · Apollo · working",
      "Ante's · Apollo · working",
    ]);
    expect(entries.filter((e) => e.group === "Issue").every((e) => e.hint.endsWith("Zeus"))).toBe(
      true,
    );
    // Managing the nearby room does not let one spawn from here: only view in this one.
    expect(entries.some((e) => e.action.kind === "spawn")).toBe(false);
  });

  test("spawning and queueing need the right to work in the room; looking at the queue does not", () => {
    const base = { ...EMPTY, rooms: { f1: room() }, currentOperationId: "f1" };
    const kinds = (access: OperationInfo["access"]) =>
      buildEntries({ ...base, operations: [info("f1", access)] })
        .filter((e) => e.group === "Action")
        .map((e) => e.action.kind);
    expect(kinds("view")).toEqual(["queuePanel", "help"]);
    expect(kinds("spawn")).toEqual(["spawn", "queueAdd", "queuePanel", "help"]);
    expect(kinds("manage")).toEqual(["spawn", "queueAdd", "queuePanel", "help"]);
    const spawn = buildEntries({ ...base, operations: [info("f1", "spawn")] }).find(
      (e) => e.action.kind === "spawn",
    );
    // The free desk of the fixture.
    expect(spawn?.action).toEqual({ kind: "spawn", seatId: "seat-2" });
  });

  test("no free desk, no spawn entry", () => {
    const full = room({
      desks: { "seat-1": { seatId: "seat-1", agentId: "a1" } },
      henchmen: { a1: henchmanFixture },
    });
    const entries = buildEntries({
      ...EMPTY,
      rooms: { f1: full },
      currentOperationId: "f1",
      operations: [info("f1", "manage")],
    });
    expect(entries.some((e) => e.action.kind === "spawn")).toBe(false);
    expect(entries.some((e) => e.action.kind === "queueAdd")).toBe(true);
  });

  test("outside every project room there is nothing to spawn or queue", () => {
    const entries = buildEntries({
      ...EMPTY,
      rooms: { f1: room() },
      currentOperationId: null,
      operations: [info("f1", "manage")],
    });
    expect(titles(entries, "Action")).toEqual(["Keyboard shortcuts"]);
    expect(titles(entries, "Henchman")).toHaveLength(2);
  });
});

describe("palette entries: by role", () => {
  test("build mode and the Office and Henchmen tabs are for owners and admins", () => {
    const forRole = (v: PaletteSources["viewer"]) => buildEntries({ ...EMPTY, viewer: v });
    expect(titles(forRole(member), "Settings")).toEqual([
      "Settings: You",
      "Settings: Agents",
      "Settings: Watchdog",
      "Settings: Notifications",
      "Settings: Display and sound",
    ]);
    expect(titles(forRole(owner), "Settings")).toContain("Settings: Office");
    expect(titles(forRole(owner), "Settings")).toContain("Settings: Henchmen");
    expect(forRole(member).some((e) => e.action.kind === "addOperation")).toBe(false);
    expect(forRole(viewer).some((e) => e.action.kind === "addOperation")).toBe(false);
    expect(forRole(null).some((e) => e.action.kind === "addOperation")).toBe(false);
    expect(titles(forRole(owner), "Action")).toEqual([
      "New operation (build mode)",
      "Keyboard shortcuts",
    ]);
  });

  test("office agents: one's own and, for members and above, the shared ones", () => {
    const base = Object.values(buildingFixture.officeAgents)[0] as OfficeAgentBody;
    const body = (agentId: string, name: string, ownerUserId: string): OfficeAgentBody => ({
      ...base,
      agentId,
      name,
      ownerUserId,
      ownerName: ownerUserId,
    });
    const agents = [
      body("pm", "Moneypenny", ""),
      body("mine", "Igor", "mia"),
      body("theirs", "Oddjob", "olga"),
    ];
    const forViewer = (v: PaletteSources["viewer"]) =>
      titles(buildEntries({ ...EMPTY, agents, viewer: v }), "Agent");
    expect(forViewer(member)).toEqual(["Talk to Igor", "Talk to Moneypenny"]);
    // Someone else's assistant is nobody's to talk to, an owner's included (D32).
    expect(forViewer({ id: "ada", role: "admin" })).toEqual(["Talk to Moneypenny"]);
    // Talking to a shared agent spends the office key: not for viewers.
    expect(forViewer(viewer)).toEqual([]);
    expect(forViewer(null)).toEqual([]);
  });

  test("people: everyone but oneself, with the place 'who's where' gives them", () => {
    const row = (sessionId: string, name: string, label: string, self = false): WhereaboutsRow => ({
      sessionId,
      userId: sessionId,
      name,
      place: { label, zone: "room", roomId: null },
      doing: "",
      seated: false,
      self,
    });
    const entries = buildEntries({
      ...EMPTY,
      people: [row("s1", "Mia", "Lobby", true), row("s2", "Olga", BEHIND_CLOSED_DOOR)],
    });
    expect(entries.filter((e) => e.group === "Person")).toEqual([
      {
        id: "person:s2",
        group: "Person",
        title: "Walk to Olga",
        hint: BEHIND_CLOSED_DOOR,
        action: { kind: "person", sessionId: "s2", name: "Olga" },
      },
    ]);
  });
});

describe("palette results", () => {
  const entry = (id: string, group: PaletteEntry["group"], title: string, hint = "") =>
    ({ id, group, title, hint, action: { kind: "help" } }) as PaletteEntry;
  const list = [
    entry("a", "Action", "Keyboard shortcuts"),
    entry("b", "Room", "Go to Apollo", "Octo"),
    entry("c", "Henchman", "Walk to Gasket", "Ante's · Apollo · working"),
    entry("d", "Issue", "#12 Apollo docs are stale", "open · Apollo"),
    entry("e", "Settings", "Settings: You"),
  ];

  test("nothing typed: everything, in order, and no search row", () => {
    expect(paletteResults(list, "  ")).toEqual({ shown: list, more: 0 });
  });

  test("every word must match somewhere; a title match comes before a hint match", () => {
    const { shown } = paletteResults(list, "apollo");
    expect(shown.map((e) => e.id)).toEqual(["b", "d", "c", "search"]);
    expect(paletteResults(list, "apollo walk").shown.map((e) => e.id)).toEqual(["c", "search"]);
    expect(paletteResults(list, "APOLLO octo").shown.map((e) => e.id)).toEqual(["b", "search"]);
  });

  test("a group's name and an issue's number find their rows", () => {
    expect(paletteResults(list, "henchman").shown[0]?.id).toBe("c");
    expect(paletteResults(list, "#12").shown[0]?.id).toBe("d");
    expect(paletteResults(list, "sett").shown[0]?.id).toBe("e");
  });

  test("the last row hands what was typed to search (#41), also when nothing else matches", () => {
    const { shown } = paletteResults(list, " needle in logs ");
    expect(shown).toHaveLength(1);
    expect(shown[0]).toMatchObject({
      group: "Search",
      title: "Search chat and terminals for “needle in logs”",
      action: { kind: "search", query: "needle in logs" },
    });
  });

  test("a long list is capped and says how many are left out; search stays last", () => {
    const many = Array.from({ length: 100 }, (_, i) => entry(`i${i}`, "Issue", `#${i} fix thing`));
    const all = paletteResults(many, "");
    expect(all.shown).toHaveLength(PALETTE_MAX_SHOWN);
    expect(all.more).toBe(100 - PALETTE_MAX_SHOWN);
    const some = paletteResults(many, "fix");
    expect(some.shown).toHaveLength(PALETTE_MAX_SHOWN);
    expect(some.shown.at(-1)?.group).toBe("Search");
    expect(some.more).toBe(101 - PALETTE_MAX_SHOWN);
  });
});
