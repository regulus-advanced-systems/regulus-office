import { describe, expect, test } from "bun:test";
import type { QueueTask } from "@regulus/protocol";
import {
  largeTemplate,
  lobbyTemplate,
  officeL2Template,
  type RoomTemplate,
  smallTemplate,
} from "@regulus/room-layout";
import { clipboardAnchors, clipboardInReach } from "./clipboardAnchors.ts";
import { clipboardKey, layoutClipboard } from "./clipboardTexture.ts";

const t = (id: string, state: QueueTask["state"], position: number) =>
  ({ id, title: `Task ${id}`, state, position }) as QueueTask;

describe("queue clipboard (#37)", () => {
  test("every project room hangs one clipboard on its queue anchor; the lobby none", () => {
    for (const tpl of [smallTemplate, officeL2Template, largeTemplate] as RoomTemplate[]) {
      const clips = clipboardAnchors(tpl);
      expect(clips.map((c) => c.anchor.kind)).toEqual(["queue_clipboard"]);
      const [clip] = clips;
      if (!clip) throw new Error("no clipboard");
      expect(clipboardInReach(clips, clip.stand)).toBe(clip);
      expect(clipboardInReach(clips, { x: clip.stand.x + 5, z: clip.stand.z })).toBeNull();
    }
    expect(clipboardAnchors(lobbyTemplate)).toEqual([]);
  });

  test("a moved anchor moves the clipboard (data-driven)", () => {
    const moved = {
      ...smallTemplate,
      wallAnchors: smallTemplate.wallAnchors.map((a) =>
        a.kind === "queue_clipboard" ? { ...a, wallId: "north", t: 3 } : a,
      ),
    } as RoomTemplate;
    expect(clipboardAnchors(moved)[0]?.wall.id).toBe("north");
  });

  test("the paper lists running tasks first, then the queue in order, then +N more", () => {
    const tasks = [
      t("q2", "queued", 2),
      t("d", "done", 3),
      t("r", "running", 1),
      t("q1", "queued", 0),
    ];
    const layout = layoutClipboard(tasks, { width: 160, height: 224 });
    expect(layout.lines.map((l) => l.text)).toEqual(["Task r", "Task q1", "Task q2"]);
    expect([layout.running, layout.queued, layout.hidden]).toEqual([1, 2, 0]);
    const many = Array.from({ length: 20 }, (_, i) => t(`${i}`, "queued", i));
    const full = layoutClipboard(many, { width: 160, height: 224 });
    expect(full.lines.length + full.hidden).toBe(20);
    expect(full.hidden).toBeGreaterThan(0);
    expect(clipboardKey(full)).not.toBe(clipboardKey(layout));
  });
});
