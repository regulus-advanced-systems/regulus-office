/**
 * Wall pictures in the scene (#46): the ray onto a wall, the placement
 * ghost's verdict, resize clamps, and the store that only sends what fits.
 */
import { afterEach, describe, expect, test } from "bun:test";
import {
  type ClientCommandPayload,
  type ClientCommandType,
  type DecorState,
  WALL_PICTURE_LIMITS,
} from "@regulus/protocol";
import { generateRoom } from "@regulus/room-layout";
import { usePicturesStore } from "../../ui/pictures/picturesStore.ts";
import { fitSize, precheck } from "../../ui/pictures/upload.ts";
import { draftVerdict, ghostAt, resizeToward, stepSize, wallHit } from "./pictureGeometry.ts";

const room = generateRoom({
  width: 4,
  depth: 4,
  doorSide: "south",
  deskCount: 1,
  decorStyle: "ops_room",
});

const picture = (over: Partial<DecorState> = {}): DecorState => ({
  id: "d1",
  kind: "picture",
  wallId: "north",
  x: 3,
  y: 2.5,
  w: 0.6,
  h: 0.4,
  imageUrl: "/api/operations/o/pictures/d1",
  placedBy: "u1",
  ...over,
});

describe("the pointer's ray onto a wall", () => {
  test("a ray from inside the room hits the north wall's face at its point", () => {
    const hit = wallHit(room, { x: 3, y: 2, z: 4 }, { x: 0, y: 0, z: -1 });
    expect(hit?.wallId).toBe("north");
    expect(hit?.x).toBeCloseTo(3);
    expect(hit?.y).toBeCloseTo(2);
    // The face stands half a wall thickness into the room.
    expect(hit?.distance).toBeCloseTo(3.9);
  });

  test("the west wall measures along +z; the nearest wall wins", () => {
    const hit = wallHit(room, { x: 4, y: 2, z: 5 }, { x: -1, y: 0, z: -0.2 });
    expect(hit?.wallId).toBe("west");
    expect(hit?.x).toBeCloseTo(5 - 0.2 * 3.9, 1);
  });

  test("stub walls, the door, the back of a wall and the ceiling are not hit", () => {
    expect(wallHit(room, { x: 3, y: 2, z: 4 }, { x: 1, y: 0, z: 0 })).toBeNull();
    expect(wallHit(room, { x: 3, y: 2, z: 4 }, { x: 0, y: 0, z: 1 })).toBeNull();
    expect(wallHit(room, { x: 3, y: 2, z: -2 }, { x: 0, y: 0, z: -1 })).toBeNull();
    expect(wallHit(room, { x: 3, y: 2, z: 4 }, { x: 0, y: 1, z: -0.1 })).toBeNull();
  });
});

describe("the placement ghost", () => {
  const size = { w: 0.6, h: 0.4 };

  test("green above the boards, red on them, red on another picture", () => {
    const above = ghostAt(room, { wallId: "west", x: 2.25, y: 2.5 }, size);
    if (!above) throw new Error("no ghost");
    expect(draftVerdict(room, {}, above)).toEqual({ ok: true });
    const onBoard = ghostAt(room, { wallId: "west", x: 2.25, y: 1.5 }, size);
    if (!onBoard) throw new Error("no ghost");
    expect(draftVerdict(room, {}, onBoard)).toMatchObject({ ok: false, problem: "overlaps_anchor" });
    const there = { d1: picture({ wallId: "west", x: 2.4 }) };
    expect(draftVerdict(room, there, above)).toMatchObject({ ok: false, problem: "overlaps_picture" });
    // Moving that very picture ignores itself.
    expect(draftVerdict(room, there, above, "d1")).toEqual({ ok: true });
  });

  test("the ghost stays on the wall's band: pulled in from the ends, the floor and the top", () => {
    const low = ghostAt(room, { wallId: "north", x: 0, y: 0 }, size);
    expect(low).toMatchObject({ wallId: "north" });
    expect(low?.x).toBeCloseTo(0.15 + 0.3);
    expect(low?.y).toBeCloseTo(0.9 + 0.2);
    const high = ghostAt(room, { wallId: "north", x: 99, y: 99 }, size);
    expect(high?.x).toBeCloseTo(8 - 0.15 - 0.3);
    expect(high?.y).toBeCloseTo(3 - 0.12 - 0.2);
    expect(ghostAt(room, { wallId: "nope", x: 1, y: 1 }, size)).toBeNull();
  });
});

describe("resizing", () => {
  const rect = { x: 3, y: 2.5, w: 0.6, h: 0.4 };

  test("a corner drag scales about the centre and keeps the aspect", () => {
    const s = resizeToward(rect, { x: 3.6, y: 2.5 });
    expect(s.w).toBeCloseTo(1.2);
    expect(s.h).toBeCloseTo(0.8);
    // The vertical pull wins when it is the bigger one.
    const tall = resizeToward(rect, { x: 3.1, y: 3 });
    expect(tall.h).toBeCloseTo(1);
    expect(tall.w).toBeCloseTo(1.5);
  });

  test("it is clamped to the size limits", () => {
    const tiny = resizeToward(rect, { x: 3.01, y: 2.5 });
    expect(Math.min(tiny.w, tiny.h)).toBeCloseTo(WALL_PICTURE_LIMITS.minSize);
    expect(tiny.w / tiny.h).toBeCloseTo(1.5);
    const huge = resizeToward(rect, { x: 9, y: 2.5 });
    expect(Math.max(huge.w, huge.h)).toBeCloseTo(WALL_PICTURE_LIMITS.maxSize);
    expect(huge.w / huge.h).toBeCloseTo(1.5);
  });

  test("keyboard steps grow and shrink by a tenth, within the limits", () => {
    expect(stepSize({ w: 1, h: 0.5 }, 1).w).toBeCloseTo(1.1);
    expect(stepSize({ w: 1, h: 0.5 }, -1).w).toBeCloseTo(1 / 1.1);
    expect(stepSize({ w: 2, h: 1 }, 1)).toEqual({ w: 2, h: 1 });
    expect(stepSize({ w: 0.45, h: 0.3 }, -1).h).toBeCloseTo(0.3);
  });
});

describe("the pictures store", () => {
  const sent: Array<{ type: string; payload: unknown }> = [];
  const send = <T extends ClientCommandType>(type: T, payload: ClientCommandPayload<T>) => {
    sent.push({ type, payload });
  };
  const upload = { uploadId: "up1", kind: "png" as const, width: 1600, height: 1200, bytes: 9 };

  afterEach(() => {
    usePicturesStore.getState().cancel();
    sent.length = 0;
  });

  test("placing starts at the default size and hangs only a ghost that fits", () => {
    const store = usePicturesStore.getState();
    store.startPlacing("op1", upload, "blob:x");
    const mode = usePicturesStore.getState().mode;
    expect(mode.kind === "placing" && mode.size.w).toBeCloseTo(WALL_PICTURE_LIMITS.defaultSize);
    expect(store.place(send)).toBe(false);
    const bad = { wallId: "west", x: 2.25, y: 1.5, w: 0.9, h: 0.675 };
    store.setDraft(bad, draftVerdict(room, {}, bad));
    expect(store.place(send)).toBe(false);
    expect(sent).toEqual([]);
    const good = { ...bad, y: 2.5 };
    store.setDraft(good, draftVerdict(room, {}, good));
    expect(store.place(send)).toBe(true);
    expect(sent).toEqual([
      { type: "decor.place", payload: { kind: "picture", uploadId: "up1", ...good } },
    ]);
    expect(usePicturesStore.getState().mode.kind).toBe("idle");
  });

  test("a dragged picture is moved only when it fits; otherwise it snaps back", () => {
    const store = usePicturesStore.getState();
    store.select("op1", "d1");
    store.setDragging(true);
    const bad = { wallId: "west", x: 2.25, y: 1.5, w: 0.6, h: 0.4 };
    store.setDraft(bad, draftVerdict(room, {}, bad, "d1"));
    expect(store.commitMove(send)).toBe(false);
    const mode = usePicturesStore.getState().mode;
    expect(mode.kind === "editing" && mode.draft).toBeNull();
    expect(mode.kind === "editing" && mode.dragging).toBe(false);
    const good = { ...bad, y: 2.5 };
    store.setDraft(good, draftVerdict(room, {}, good, "d1"));
    expect(store.commitMove(send)).toBe(true);
    expect(sent).toEqual([{ type: "decor.move", payload: { decorId: "d1", ...good } }]);
    store.remove(send);
    expect(sent[1]).toEqual({ type: "decor.remove", payload: { decorId: "d1" } });
  });

  test("a click without a drag sends nothing", () => {
    const store = usePicturesStore.getState();
    store.select("op1", "d1");
    store.setDragging(true);
    expect(store.commitMove(send)).toBe(false);
    expect(sent).toEqual([]);
  });
});

describe("before uploading", () => {
  test("only PNG, JPEG and WebP up to 10 MB", () => {
    expect(precheck({ type: "image/png", size: 1000 })).toBeNull();
    expect(precheck({ type: "image/webp", size: 1000 })).toBeNull();
    expect(precheck({ type: "image/gif", size: 1000 })).toBe("not_image");
    expect(precheck({ type: "image/svg+xml", size: 10 })).toBe("not_image");
    expect(precheck({ type: "image/jpeg", size: WALL_PICTURE_LIMITS.uploadMaxBytes + 1 })).toBe(
      "too_large",
    );
  });

  test("big images are scaled down to the longest side, never up", () => {
    expect(fitSize(4096, 2048)).toEqual({ width: 2048, height: 1024 });
    expect(fitSize(800, 600)).toEqual({ width: 800, height: 600 });
    expect(fitSize(1000, 5000)).toEqual({ width: 410, height: 2048 });
  });
});
