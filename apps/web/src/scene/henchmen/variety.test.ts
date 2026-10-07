/** Crew variety (#281): hair and skin tone from the id, the same every time, spread over the crew. */
import { describe, expect, test } from "bun:test";
import {
  crewVariant,
  DEFAULT_VARIANT,
  HAIR_COLOURS,
  HAIR_STYLES,
  hashId,
  SKIN_TONES,
} from "./variety.ts";

const ids = Array.from({ length: 400 }, (_, i) => `agent-${i.toString(36)}-${i * 7919}`);

describe("crew variety", () => {
  test("the same id is always the same person; no id is the default crew member", () => {
    for (const id of ids.slice(0, 50)) expect(crewVariant(id)).toEqual(crewVariant(id));
    expect(crewVariant(undefined)).toBe(DEFAULT_VARIANT);
    expect(crewVariant("")).toBe(DEFAULT_VARIANT);
    // Pinned: a change to the hash or the lists would silently give every henchman a new face.
    expect(hashId("rivet")).toBe(3107628093);
    expect(crewVariant("rivet")).toEqual({ hair: "flattop", tone: 2, hairColour: 0 });
    expect(crewVariant("chisel")).toEqual({ hair: "ponytail", tone: 1, hairColour: 4 });
    expect(crewVariant("valve")).toEqual({ hair: "balding", tone: 3, hairColour: 1 });
    expect(crewVariant("moneypenny")).toEqual({ hair: "ponytail", tone: 1, hairColour: 3 });
  });

  test("every variant is in range", () => {
    for (const id of ids) {
      const v = crewVariant(id);
      expect(HAIR_STYLES).toContain(v.hair);
      expect(v.tone).toBeGreaterThanOrEqual(0);
      expect(v.tone).toBeLessThan(SKIN_TONES.length);
      expect(v.hairColour).toBeGreaterThanOrEqual(0);
      expect(v.hairColour).toBeLessThan(HAIR_COLOURS.length);
    }
  });

  test("a crew is a mix: every hair style, tone and hair colour turns up, none dominates", () => {
    const count = (key: (id: string) => string | number, kinds: number) => {
      const seen = new Map<string | number, number>();
      for (const id of ids) seen.set(key(id), (seen.get(key(id)) ?? 0) + 1);
      expect(seen.size).toBe(kinds);
      for (const n of seen.values()) {
        expect(n).toBeGreaterThan((ids.length / kinds) * 0.5);
        expect(n).toBeLessThan((ids.length / kinds) * 1.6);
      }
    };
    count((id) => crewVariant(id).hair, HAIR_STYLES.length);
    count((id) => crewVariant(id).tone, SKIN_TONES.length);
    count((id) => crewVariant(id).hairColour, HAIR_COLOURS.length);
  });

  test("hair, tone and colour vary independently; ids one character apart differ", () => {
    const combos = new Set(
      ids.map((id) => {
        const v = crewVariant(id);
        return `${v.hair}/${v.tone}/${v.hairColour}`;
      }),
    );
    // 6 styles x 6 tones x 7 colours = 252 combinations; 400 ids reach most of them.
    expect(combos.size).toBeGreaterThan(150);
    const neighbours = ["agent-1", "agent-2", "agent-3", "agent-4", "agent-5", "agent-6"].map(
      (id) => JSON.stringify(crewVariant(id)),
    );
    expect(new Set(neighbours).size).toBeGreaterThanOrEqual(5);
  });

  test("twenty henchmen in a room do not look alike", () => {
    const room = Array.from({ length: 20 }, (_, i) => crewVariant(`01HZX${i}QWERTY${i * 31}`));
    expect(new Set(room.map((v) => v.hair)).size).toBeGreaterThanOrEqual(4);
    expect(new Set(room.map((v) => v.tone)).size).toBeGreaterThanOrEqual(4);
    expect(new Set(room.map((v) => `${v.hair}/${v.tone}/${v.hairColour}`)).size).toBeGreaterThan(
      14,
    );
  });
});
