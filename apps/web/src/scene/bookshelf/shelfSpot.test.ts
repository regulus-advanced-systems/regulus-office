/**
 * Whose `E` it is at the bookshelf (#264): the shelf's from in front of it,
 * a desk's when the desk is nearer, and never both.
 */
import { describe, expect, test } from "bun:test";
import { DECOR_STYLES, ROOM_MAX_TILES, ROOM_MIN_TILES } from "@regulus/protocol";
import { COMPASS_DIRECTIONS, generateRoom, maxDeskCount } from "@regulus/room-layout";
import { useDom } from "../../ui/a11y/dom.ts";
import { dispatchHotkey, HOTKEY_EVENT, type HotkeyEventDetail } from "../../ui/hotkeys/registry.ts";
import { BOARD_INTERACT_RADIUS, boardAnchors } from "../boards/boardAnchors.ts";
import { GONG_INTERACT_RADIUS, gongAnchors } from "../gong/gongAnchor.ts";
import { DESK_FOCUS_RADIUS } from "../laptops/focus.ts";
import { CLIPBOARD_INTERACT_RADIUS, clipboardAnchors } from "../queue/clipboardAnchors.ts";
import { listenForShelfE } from "./BookshelfLayer.tsx";
import { SHELF_REACH, shelfSpot, shelfTakesE } from "./shelfSpot.ts";

useDom();

const room = (w: number, d: number, side: (typeof COMPASS_DIRECTIONS)[number], desks = 1) =>
  generateRoom({
    width: w,
    depth: d,
    doorSide: side,
    deskCount: desks,
    decorStyle: DECOR_STYLES[0],
  });

describe("the shelf's E", () => {
  test("is the shelf's at its stand point in every room, and out of reach it is not", () => {
    for (let w = ROOM_MIN_TILES; w <= ROOM_MAX_TILES; w++) {
      for (let d = ROOM_MIN_TILES; d <= ROOM_MAX_TILES; d++) {
        for (const side of COMPASS_DIRECTIONS) {
          for (const desks of [1, maxDeskCount(w, d)]) {
            const spot = shelfSpot(room(w, d, side, desks));
            if (!spot) throw new Error(`${w}x${d} ${side}: no docs shelf`);
            expect(shelfTakesE(spot, spot.stand)).toBe(true);
            // Further than any desk's reach: standing there, E can only mean the shelf.
            const nearestDesk = Math.min(
              ...spot.desks.map((p) => Math.hypot(p.x - spot.stand.x, p.z - spot.stand.z)),
            );
            expect(nearestDesk).toBeGreaterThanOrEqual(2);
          }
        }
      }
    }
  });

  test("a desk nearer to the player than the shelf's stand point keeps its E", () => {
    const spot = shelfSpot(room(4, 4, "east"));
    if (!spot) throw new Error("no docs shelf");
    const desk = spot.desks.reduce((a, b) =>
      Math.hypot(a.x - spot.stand.x, a.z - spot.stand.z) <
      Math.hypot(b.x - spot.stand.x, b.z - spot.stand.z)
        ? a
        : b,
    );
    const between = (t: number) => ({
      x: spot.stand.x + (desk.x - spot.stand.x) * t,
      z: spot.stand.z + (desk.z - spot.stand.z) * t,
    });
    // In the smallest room an occupied desk would answer E from the shelf's stand point too.
    const gap = Math.hypot(desk.x - spot.stand.x, desk.z - spot.stand.z);
    expect(gap).toBeLessThan(DESK_FOCUS_RADIUS);
    expect(shelfTakesE(spot, between(0.2))).toBe(true);
    expect(shelfTakesE(spot, between(0.45))).toBe(true);
    expect(shelfTakesE(spot, between(0.55))).toBe(false);
    expect(shelfTakesE(spot, desk)).toBe(false);
    expect(shelfTakesE(null, spot.stand)).toBe(false);
    // Were a desk closer still: past half way it is nearer, though the shelf is in reach.
    const tight = { ...spot, desks: [{ x: spot.stand.x + 1.2, z: spot.stand.z }] };
    expect(shelfTakesE(tight, { x: spot.stand.x + 0.5, z: spot.stand.z })).toBe(true);
    expect(shelfTakesE(tight, { x: spot.stand.x + 0.7, z: spot.stand.z })).toBe(false);
    expect(0.7).toBeLessThan(SHELF_REACH);
    expect(shelfSpot({ ...room(4, 4, "east"), obstacles: [] })).toBeNull();
  });

  test("no spot is in reach of both the shelf and a board, the clipboard or the gong", () => {
    for (const [w, d] of [
      [4, 4],
      [4, 7],
      [6, 6],
      [9, 12],
      [12, 12],
    ] as const) {
      for (const side of COMPASS_DIRECTIONS) {
        const layout = room(w, d, side, maxDeskCount(w, d));
        const spot = shelfSpot(layout);
        if (!spot) throw new Error("no docs shelf");
        const others = [
          ...boardAnchors(layout).map((b) => ({ at: b.stand, reach: BOARD_INTERACT_RADIUS })),
          ...clipboardAnchors(layout).map((c) => ({
            at: c.stand,
            reach: CLIPBOARD_INTERACT_RADIUS,
          })),
          ...gongAnchors(layout).map((g) => ({ at: g.stand, reach: GONG_INTERACT_RADIUS })),
        ];
        for (const other of others) {
          const gap = Math.hypot(other.at.x - spot.stand.x, other.at.z - spot.stand.z);
          expect(gap).toBeGreaterThan(SHELF_REACH + other.reach);
        }
      }
    }
  });

  test("the shelf answers before the other listeners and alone; elsewhere it leaves E to them", () => {
    const spot = shelfSpot(room(4, 4, "east"));
    if (!spot) throw new Error("no docs shelf");
    const heard: string[] = [];
    // A layer that listened first and does not look at `handled` (desks, boards).
    const desk = (event: Event) => {
      heard.push("desk");
      (event as CustomEvent<HotkeyEventDetail>).detail.handled = true;
    };
    window.addEventListener(HOTKEY_EVENT, desk);
    let player = { ...spot.stand, spawned: true };
    const remove = listenForShelfE(
      window,
      spot,
      () => player,
      () => heard.push("shelf"),
    );
    const interact = { id: "interact", key: "e", description: "", group: "" };
    dispatchHotkey(interact);
    expect(heard).toEqual(["shelf"]);

    heard.length = 0;
    player = { x: spot.desks[0]?.x ?? 0, z: spot.desks[0]?.z ?? 0, spawned: true };
    dispatchHotkey(interact);
    expect(heard).toEqual(["desk"]);

    heard.length = 0;
    player = { ...spot.stand, spawned: false };
    dispatchHotkey(interact);
    dispatchHotkey({ ...interact, id: "toggleView", key: "v" });
    expect(heard).toEqual(["desk", "desk"]);

    heard.length = 0;
    remove();
    player = { ...spot.stand, spawned: true };
    dispatchHotkey(interact);
    expect(heard).toEqual(["desk"]);
    window.removeEventListener(HOTKEY_EVENT, desk);
  });
});
