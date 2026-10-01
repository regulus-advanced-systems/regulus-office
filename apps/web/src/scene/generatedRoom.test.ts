/**
 * Generated rooms (#182) go through today's scene helpers unchanged: every
 * desk seat gets a chair model with sit data and a laptop on its table, and
 * the boards, clipboard and gong find their wall anchors. #186 draws them.
 */
import { describe, expect, test } from "bun:test";
import { generateRoom, maxDeskCount, rectContains } from "@regulus/room-layout";
import { DECOR_STYLES } from "@regulus/protocol";
import { boardAnchors } from "./boards/boardAnchors.ts";
import { sitAnchors } from "./furniture/sitAnchor.ts";
import { gongAnchors } from "./gong/gongAnchor.ts";
import { laptopPlacements } from "./laptops/placement.ts";
import { clipboardAnchors } from "./queue/clipboardAnchors.ts";
import { roomPieces } from "./room/roomPieces.ts";
import { rugPieces } from "./room/rugs.ts";

const CASES = [
  [4, 4, "south"],
  [7, 9, "west"],
  [12, 12, "north"],
  [10, 6, "east"],
] as const;

describe("generated rooms in the scene helpers", () => {
  test.each(CASES)("%i x %i, door %s", (width, depth, doorSide) => {
    for (const decorStyle of DECOR_STYLES) {
      const deskCount = maxDeskCount(width, depth);
      const room = generateRoom({ width, depth, doorSide, deskCount, decorStyle });
      const desks = room.seats.filter((s) => s.kind === "desk");
      expect(sitAnchors(room).size).toBe(room.seats.length);
      const laptops = laptopPlacements(room);
      expect(laptops).toHaveLength(deskCount * 4);
      for (const laptop of laptops) {
        const seat = desks.find((s) => s.id === laptop.seatId);
        const table = room.obstacles.find((o) => o.id === seat?.furnitureId);
        if (!table) throw new Error(`no table for ${laptop.seatId}`);
        expect(rectContains(table.rect, { x: laptop.position[0], z: laptop.position[2] })).toBe(
          true,
        );
      }
      expect(
        boardAnchors(room)
          .map((b) => b.anchor.kind)
          .sort(),
      ).toEqual(["issue_board", "pr_board"]);
      expect(clipboardAnchors(room)).toHaveLength(1);
      expect(gongAnchors(room)).toHaveLength(1);
      expect(roomPieces(room).walls.length).toBeGreaterThanOrEqual(6);
      expect(rugPieces(room.rugs, room.room.materials.palette).length).toBeGreaterThan(0);
    }
  });
});
