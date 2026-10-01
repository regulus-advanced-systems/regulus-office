import { describe, expect, test } from "bun:test";
import {
  BLAST_DOOR_GLOBAL_COOLDOWN_MS,
  BLAST_DOOR_PRESS_COOLDOWN_MS,
  BlastDoorStateSchema,
  blastDoorButtons,
  type CompoundState,
  EMPTY_COMPOUND,
} from "@regulus/protocol";
import { type BlastDoorPress, createBlastDoor } from "./blast-door.ts";

const compound: CompoundState = {
  ...EMPTY_COMPOUND,
  width: 64,
  depth: 64,
  outsideDepth: 6,
  version: 1,
  blastDoorX: 30,
  blastDoorY: 64,
  blastDoorWidth: 4,
};
const [inside, outside] = blastDoorButtons(compound);
const ada = { userId: "u-ada", displayName: "Ada" };
const bob = { userId: "u-bob", displayName: "Bob" };

function setup(openMs = 20_000) {
  let t = 1_000_000;
  const audits: BlastDoorPress[] = [];
  const door = createBlastDoor({ openMs, audit: (p) => audits.push(p) }, () => t);
  const state = new BlastDoorStateSchema();
  return {
    door,
    state,
    audits,
    advance: (ms: number) => {
      t += ms;
      door.tick(state);
    },
    now: () => t,
  };
}

describe("blast door", () => {
  test("the buttons sit either side of the doorway, inside and outside", () => {
    expect(inside.side).toBe("inside");
    expect(inside.stand.x).toBeLessThan(60);
    expect(inside.stand.z).toBeLessThan(128);
    expect(outside.stand.x).toBeGreaterThan(68);
    expect(outside.stand.z).toBeGreaterThan(128);
  });

  test("a press at the lobby button opens it for its open time, warns, then shuts", () => {
    const s = setup(20_000);
    const result = s.door.press(s.state, ada, inside.stand, compound);
    expect(result).toEqual({ ok: true, press: { ...ada, side: "inside", held: false } });
    expect(s.state.phase).toBe("open");
    expect(s.state.openedAt).toBe(s.now());
    expect(s.state.closesAt).toBe(s.now() + 20_000);
    expect(s.state.openedBy).toBe("Ada");
    expect(s.state.presses).toBe(1);
    s.advance(14_900);
    expect(s.state.phase).toBe("open");
    // The warning is the last 5 s of a 20 s period (a quarter, under the 6 s cap).
    s.advance(200);
    expect(s.state.phase).toBe("closing");
    s.advance(5_900);
    expect(s.state.phase).toBe("closed");
    expect(s.state.closesAt).toBe(0);
    expect(s.audits).toHaveLength(1);
  });

  test("a press while open holds it for another full period, and is audited as a hold", () => {
    const s = setup(20_000);
    s.door.press(s.state, ada, inside.stand, compound);
    s.advance(16_000);
    expect(s.state.phase).toBe("closing");
    const held = s.door.press(s.state, bob, outside.stand, compound);
    expect(held).toEqual({ ok: true, press: { ...bob, side: "outside", held: true } });
    expect(s.state.phase).toBe("open");
    expect(s.state.closesAt).toBe(s.now() + 20_000);
    expect(s.audits.map((a) => a.held)).toEqual([false, true]);
  });

  test("only someone standing at a button may press it", () => {
    const s = setup();
    const far = s.door.press(s.state, ada, { x: 10, z: 10 }, compound);
    expect(far).toEqual({ ok: false, reason: "Walk up to the blast door button to press it." });
    const noLayout = s.door.press(s.state, ada, inside.stand, undefined);
    expect(noLayout.ok).toBe(false);
    expect(s.state.phase).toBe("closed");
    expect(s.audits).toHaveLength(0);
  });

  test("presses are rate-limited per human and globally", () => {
    const s = setup();
    expect(s.door.press(s.state, ada, inside.stand, compound).ok).toBe(true);
    // Anyone, right after any press: the door is moving.
    expect(s.door.press(s.state, bob, inside.stand, compound)).toEqual({
      ok: false,
      reason: "The blast door is already moving.",
    });
    s.advance(BLAST_DOOR_GLOBAL_COOLDOWN_MS);
    // Bob may now; Ada still waits out her own cooldown.
    expect(s.door.press(s.state, ada, inside.stand, compound).ok).toBe(false);
    s.advance(BLAST_DOOR_GLOBAL_COOLDOWN_MS);
    expect(s.door.press(s.state, bob, inside.stand, compound).ok).toBe(true);
    s.advance(BLAST_DOOR_PRESS_COOLDOWN_MS);
    expect(s.door.press(s.state, ada, inside.stand, compound).ok).toBe(true);
    expect(s.state.presses).toBe(3);
    expect(s.audits).toHaveLength(3);
  });
});
