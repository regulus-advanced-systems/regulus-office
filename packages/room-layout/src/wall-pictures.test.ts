import { describe, expect, test } from "bun:test";
import { DECOR_STYLES } from "@regulus/protocol";
import { generateRoom } from "./room/generate.ts";
import {
  checkPicturePlacement,
  clampToWall,
  PICTURE_MIN_BOTTOM,
  pictureWalls,
} from "./wall-pictures.ts";

const small = generateRoom({
  width: 4,
  depth: 4,
  doorSide: "south",
  deskCount: 1,
  decorStyle: "ops_room",
});

const anchor = (id: string) => {
  const a = small.wallAnchors.find((x) => x.id === id);
  if (!a) throw new Error(`no anchor ${id}`);
  return a;
};

describe("wall pictures: where they may hang (#46)", () => {
  test("only the full walls without a door take pictures", () => {
    expect(
      pictureWalls(small)
        .map((w) => w.id)
        .sort(),
    ).toEqual(["north", "west"]);
    expect(checkPicturePlacement(small, "door", { x: 2, y: 1.6, w: 0.6, h: 0.4 })).toEqual({
      ok: false,
      problem: "no_wall",
    });
    expect(checkPicturePlacement(small, "east", { x: 2, y: 1.6, w: 0.6, h: 0.4 }).ok).toBe(false);
    expect(checkPicturePlacement(small, "nope", { x: 2, y: 1.6, w: 0.6, h: 0.4 }).ok).toBe(false);
  });

  test("a picture above the boards fits; on a board it does not", () => {
    const board = anchor("issue-board");
    const above = { x: board.t, y: 2.5, w: 0.8, h: 0.5 };
    expect(checkPicturePlacement(small, board.wallId, above)).toEqual({ ok: true });
    const on = { x: board.t, y: board.y, w: 0.6, h: 0.4 };
    expect(checkPicturePlacement(small, board.wallId, on)).toEqual({
      ok: false,
      problem: "overlaps_anchor",
      with: "issue-board",
    });
  });

  test("the whiteboard, the usage screen, the gong and the picture frames are kept clear", () => {
    for (const id of ["whiteboard", "usage-wall", "gong", "picture-1", "queue-clipboard"]) {
      const a = anchor(id);
      const v = checkPicturePlacement(small, a.wallId, { x: a.t, y: a.y, w: 0.3, h: 0.3 });
      expect(v).toEqual({ ok: false, problem: "overlaps_anchor", with: id });
    }
  });

  test("off the wall: past its ends, too low, too high", () => {
    const v = (x: number, y: number) =>
      checkPicturePlacement(small, "north", { x, y, w: 0.6, h: 0.4 });
    expect(v(0.2, 2.5)).toMatchObject({ problem: "off_wall" });
    expect(v(7.9, 2.5)).toMatchObject({ problem: "off_wall" });
    expect(v(6.6, PICTURE_MIN_BOTTOM)).toMatchObject({ problem: "off_wall" });
    expect(v(6.6, 2.9)).toMatchObject({ problem: "off_wall" });
  });

  test("tall furniture against the wall: a picture clears it or is refused", () => {
    // The vanilla plant stands in the north-east corner.
    const plant = small.obstacles.find((o) => o.kind === "plant");
    if (!plant) throw new Error("no plant");
    const x = plant.rect.x + plant.rect.w / 2;
    expect(checkPicturePlacement(small, "north", { x, y: 1.4, w: 0.5, h: 0.5 })).toMatchObject({
      ok: false,
      problem: "overlaps_furniture",
    });
    expect(checkPicturePlacement(small, "north", { x, y: 2.5, w: 0.5, h: 0.5 }).ok).toBe(true);
  });

  test("sizes outside the limits are refused", () => {
    expect(checkPicturePlacement(small, "north", { x: 6.6, y: 2.5, w: 0.1, h: 0.4 })).toMatchObject(
      { problem: "bad_size" },
    );
    expect(checkPicturePlacement(small, "north", { x: 4, y: 2, w: 2.5, h: 0.4 })).toMatchObject({
      problem: "bad_size",
    });
    expect(
      checkPicturePlacement(small, "north", { x: Number.NaN, y: 2, w: 0.5, h: 0.4 }),
    ).toMatchObject({ problem: "bad_size" });
  });

  test("pictures keep clear of each other; the one being moved is ignored", () => {
    const one = { id: "p1", wallId: "north", x: 3, y: 2.5, w: 0.6, h: 0.5 };
    const next = { x: 3.4, y: 2.5, w: 0.6, h: 0.5 };
    expect(checkPicturePlacement(small, "north", next, [one])).toMatchObject({
      problem: "overlaps_picture",
      with: "p1",
    });
    expect(checkPicturePlacement(small, "north", next, [one], "p1").ok).toBe(true);
    // Side by side with the gap is fine; another wall never collides.
    expect(checkPicturePlacement(small, "north", { ...next, x: 3.7 }, [one]).ok).toBe(true);
    expect(checkPicturePlacement(small, "west", { ...next, x: 6.8 }, [one]).ok).toBe(true);
  });

  test("every generated room has somewhere to hang a picture", () => {
    for (const style of DECOR_STYLES) {
      for (const [w, d] of [
        [4, 4],
        [6, 8],
        [12, 12],
      ] as const) {
        for (const doorSide of ["north", "south", "east", "west"] as const) {
          const room = generateRoom({
            width: w,
            depth: d,
            doorSide,
            deskCount: 1,
            decorStyle: style,
          });
          const free = pictureWalls(room).some((wall) => {
            for (let x = 0.5; x < 24; x += 0.25) {
              if (checkPicturePlacement(room, wall.id, { x, y: 2.5, w: 0.5, h: 0.5 }).ok)
                return true;
            }
            return false;
          });
          expect(free, `${w}x${d} ${doorSide} ${style}`).toBe(true);
        }
      }
    }
  });

  test("clampToWall keeps the centre on the wall band", () => {
    const wall = pictureWalls(small)[0];
    if (!wall) throw new Error("no wall");
    const c = clampToWall(small, wall, { x: -3, y: 0, w: 0.6, h: 0.4 });
    expect(c.x).toBeCloseTo(0.15 + 0.3);
    expect(c.y).toBeCloseTo(PICTURE_MIN_BOTTOM + 0.2);
  });
});
