import { describe, expect, test } from "bun:test";
import { checkCommand, isInsideWorld, WORLD_HALF_EXTENT, wrapHeading } from "./commands.ts";

describe("checkCommand", () => {
  test("accepts a well-formed move inside the world", () => {
    const r = checkCommand("move", { x: 1, z: -2, heading: 0.5 });
    expect(r).toEqual({ ok: true, command: { type: "move", x: 1, z: -2, heading: 0.5 } });
  });

  test("rejects NaN, Infinity, missing fields and wrong types", () => {
    expect(checkCommand("move", { x: Number.NaN, z: 0, heading: 0 }).ok).toBe(false);
    expect(checkCommand("move", { x: 0, z: Number.POSITIVE_INFINITY, heading: 0 }).ok).toBe(false);
    expect(checkCommand("move", { x: 0, z: 0 }).ok).toBe(false);
    expect(checkCommand("move", { x: "1", z: 0, heading: 0 }).ok).toBe(false);
    expect(checkCommand("move", null).ok).toBe(false);
    expect(checkCommand("move", "text").ok).toBe(false);
  });

  test("rejects out-of-bounds moves with a reason", () => {
    const r = checkCommand("move", { x: WORLD_HALF_EXTENT + 1, z: 0, heading: 0 });
    expect(r).toEqual({ ok: false, reason: "invalid move: out of bounds" });
    expect(checkCommand("move", { x: 0, z: -WORLD_HALF_EXTENT - 0.01, heading: 0 }).ok).toBe(false);
    expect(isInsideWorld(WORLD_HALF_EXTENT, -WORLD_HALF_EXTENT)).toBe(true);
  });

  test("rejects unknown command types and reports the failing field", () => {
    expect(checkCommand("teleport", {}).ok).toBe(false);
    const r = checkCommand("chat", { text: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/^invalid chat: text: /);
  });

  test("applies command defaults (floor.go mode) and trims chat", () => {
    expect(checkCommand("floor.go", { floorId: "f1" })).toEqual({
      ok: true,
      command: { type: "floor.go", floorId: "f1", mode: "ride" },
    });
    expect(checkCommand("chat", { text: "  hi  " })).toEqual({
      ok: true,
      command: { type: "chat", text: "hi" },
    });
  });

  test("validates emotes and sit against the shared enums", () => {
    expect(checkCommand("emote", { emote: "wave" }).ok).toBe(true);
    expect(checkCommand("emote", { emote: "dab" }).ok).toBe(false);
    expect(checkCommand("sit", { seatId: null }).ok).toBe(true);
    expect(checkCommand("sit", { seatId: "couch-1" }).ok).toBe(true);
    expect(checkCommand("sit", {}).ok).toBe(false);
  });
});

describe("wrapHeading", () => {
  test("wraps into [-π, π)", () => {
    expect(wrapHeading(0)).toBe(0);
    expect(wrapHeading(Math.PI)).toBeCloseTo(-Math.PI);
    expect(wrapHeading(3 * Math.PI)).toBeCloseTo(-Math.PI);
    expect(wrapHeading(-3 * Math.PI)).toBeCloseTo(-Math.PI);
    expect(wrapHeading(Math.PI / 2 + 4 * Math.PI)).toBeCloseTo(Math.PI / 2);
  });
});
