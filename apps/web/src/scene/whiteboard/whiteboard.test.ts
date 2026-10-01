import { describe, expect, test } from "bun:test";
import { generateRoom } from "@regulus/room-layout";
import { snapshotSize } from "../../ui/whiteboard/editor/snapshotRender.ts";
import { specialDressing } from "../compound/special.ts";
import { resolveModelId } from "../lair/generatorModels.ts";
import { lairRoomScene } from "../lair/roomScene.ts";
import { containRect, paintSnapshot, type SnapshotCanvas } from "./snapshotTexture.ts";
import { nearestInReach, whiteboardAnchors } from "./whiteboardAnchors.ts";

describe("snapshot fitting", () => {
  test("a wide drawing fills the width, a tall one the height, centred", () => {
    expect(containRect(2000, 500, 1000, 500)).toEqual({ x: 0, y: 125, w: 1000, h: 250 });
    expect(containRect(100, 400, 1000, 500)).toEqual({ x: 437.5, y: 0, w: 125, h: 500 });
    const r = containRect(100, 100, 1000, 500, 20);
    expect([r.x, r.y, r.w, r.h].map(Math.round)).toEqual([270, 20, 460, 460]);
    expect(containRect(0, 0, 100, 100).w).toBe(0);
  });

  test("the face is painted white, then the image, or a hint when blank", () => {
    const calls: string[] = [];
    const ctx = {
      fillRect: (x: number, y: number, w: number, h: number) =>
        calls.push(`rect ${x},${y},${w},${h}`),
      drawImage: (_i: unknown, x: number, y: number, w: number, h: number) =>
        calls.push(`image ${x},${y},${w},${h}`),
      fillText: (text: string) => calls.push(`text ${text}`),
    } as unknown as SnapshotCanvas;
    paintSnapshot(ctx, 1000, 500, { width: 2000, height: 500 } as unknown as ImageBitmap);
    expect(calls).toEqual(["rect 0,0,1000,500", "image 20,130,960,240"]);
    calls.length = 0;
    paintSnapshot(ctx, 1000, 500, null);
    expect(calls[1]).toContain("press E");
  });

  test("uploads are at most 1600 px on the long side, small sketches at most 2x", () => {
    expect(snapshotSize(3200, 1600, 1600)).toEqual({ width: 1600, height: 800, scale: 0.5 });
    expect(snapshotSize(100, 50, 1600)).toEqual({ width: 200, height: 100, scale: 2 });
  });
});

describe("where boards hang", () => {
  test("a generated room has one live whiteboard, drawn as a look, not a static piece", () => {
    const layout = generateRoom({
      width: 6,
      depth: 6,
      doorSide: "south",
      deskCount: 1,
      decorStyle: "ops_room",
    });
    const boards = whiteboardAnchors(layout);
    expect(boards).toHaveLength(1);
    expect(resolveModelId("lair/common/whiteboard")).toEqual({ look: "whiteboard" });
    const scene = lairRoomScene(layout);
    expect(scene.looks.filter((l) => l.look === "whiteboard")).toHaveLength(1);
    expect(scene.pieces.some((p) => p.piece === "whiteboard")).toBe(false);
    const b = boards[0];
    if (!b) throw new Error("no board");
    expect(nearestInReach(boards, b.stand)).toBe(b);
    expect(nearestInReach(boards, { x: b.stand.x + 3, z: b.stand.z })).toBeNull();
  });

  test("the lobby board hangs on the north wall, clear of the corridor door in the middle", () => {
    const w = 24;
    const board = specialDressing("lobby", w, 16).whiteboard;
    if (!board) throw new Error("no lobby board");
    const left = board.position[0] - board.w / 2;
    const right = board.position[0] + board.w / 2;
    expect(right).toBeLessThan(w / 2 - 2);
    expect(left).toBeGreaterThan(4);
    expect(board.position[2]).toBeLessThan(0.5);
    expect(board.stand.z).toBeGreaterThan(1);
  });
});
