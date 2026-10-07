/**
 * The dev harness's lair (#269): its levels, and the closed-room fixture it
 * publishes in the shape agreed with #270, so the scene is built against
 * what the server will send.
 */
import { describe, expect, test } from "bun:test";
import { HOLDING_LEVEL_ID, LOBBY_LEVEL_ID, type OperationSummary } from "@regulus/protocol";
import { levelLabel, levelList, levelView } from "../../../state/level.ts";
import { type CompoundWorld, compoundWorld, isClosedEntry } from "../../compound/world.ts";
import { ANTE_LEVEL, DEFAULT_CLOSED, harnessLair, REGULUS_LEVEL } from "./harnessWorld.ts";

const options = { rooms: 4, locked: [], building: [], closed: DEFAULT_CLOSED, holding: false };
const lair = harnessLair(options);
const worldOf = (levelId: string, from = lair): CompoundWorld => {
  const world = compoundWorld(levelView(from.state, levelId), new Set(from.enterable), levelId);
  if (!world) throw new Error(`no world for ${levelId}`);
  return world;
};

describe("the harness's levels (#269)", () => {
  test("the lobby level, an organisation's level and an account's level", () => {
    const levels = levelList(lair.state);
    expect(levels.map((l) => [l.levelId, l.kind, levelLabel(l, levels).mark])).toEqual([
      [LOBBY_LEVEL_ID, "lobby", "L"],
      [REGULUS_LEVEL, "org", "S1"],
      [ANTE_LEVEL, "account", "S2"],
    ]);
    expect(worldOf(LOBBY_LEVEL_ID).rooms.map((r) => r.kind)).toEqual([
      "lobby",
      "conference",
      "break_room",
    ]);
    expect(worldOf(REGULUS_LEVEL).rooms.map((r) => r.id)).toEqual([
      "landing",
      "dev",
      "apollo",
      "hermes",
      "zeus",
    ]);
    expect(worldOf(REGULUS_LEVEL).rooms.every((r) => r.kind !== "project" || r.enterable)).toBe(
      true,
    );
  });

  test("holding=1 adds the holding level, last in the lift", () => {
    const withHolding = harnessLair({ ...options, holding: true });
    const levels = levelList(withHolding.state);
    expect(levels[levels.length - 1]?.levelId).toBe(HOLDING_LEVEL_ID);
    expect(levelLabel(levels[levels.length - 1] as (typeof levels)[number], levels).title).toBe(
      "Holding level",
    );
    expect(worldOf(HOLDING_LEVEL_ID, withHolding).rooms.map((r) => r.id)).toEqual([
      "landing",
      "scratch",
    ]);
  });

  test("closed rooms are published as footprint only, and drawn with nothing else", () => {
    const sent = lair.state.operations as Record<string, OperationSummary>;
    for (const id of DEFAULT_CLOSED) {
      const entry = sent[id];
      if (!entry) throw new Error(id);
      expect(isClosedEntry(entry)).toBe(true);
      expect([
        entry.name,
        entry.slug,
        entry.henchmenWorking,
        entry.henchmenWaiting,
        entry.henchmenTotal,
      ]).toEqual(["", "", 0, 0, 0]);
      expect(entry.levelId).toBe(ANTE_LEVEL);
      expect(entry.width).toBeGreaterThan(0);
      expect(lair.enterable).not.toContain(id);
    }
    const world = worldOf(ANTE_LEVEL);
    const byId = [...world.rooms].sort((a, b) => a.id.localeCompare(b.id));
    expect(byId.map((r) => [r.id, r.closed, r.sealed, r.enterable, r.name])).toEqual([
      ["crypt", true, true, false, ""],
      ["dotfiles", false, false, true, "Dotfiles"],
      ["landing", false, false, true, "Lift landing"],
      ["sideproject", false, false, true, "Side project"],
      ["vault", true, false, false, ""],
    ]);
    expect(JSON.stringify(world)).not.toMatch(/Vault|Crypt/);
  });

  test("closed=none opens them all (the toggle)", () => {
    const open = harnessLair({ ...options, closed: [] });
    expect(worldOf(ANTE_LEVEL, open).rooms.filter((r) => r.closed)).toEqual([]);
    expect(open.enterable).toContain("vault");
  });
});
