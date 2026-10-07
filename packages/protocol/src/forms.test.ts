import { describe, expect, test } from "bun:test";
import {
  CHARACTER_FORM_IDS,
  CHARACTER_FORM_LABELS,
  DEFAULT_FORM_ID,
  formIdFor,
  isCharacterFormId,
  OFFICE_AGENT_ONLY_FORM_IDS,
} from "./forms.ts";
import { CreateSkinRule, HENCHMAN_SKIN_IDS, isHenchmanSkinId } from "./skins.ts";

describe("character forms (#281)", () => {
  test("every henchman skin is a form, in the same order, then the office-agent forms", () => {
    expect(CHARACTER_FORM_IDS.slice(0, HENCHMAN_SKIN_IDS.length)).toEqual([...HENCHMAN_SKIN_IDS]);
    expect(CHARACTER_FORM_IDS.slice(HENCHMAN_SKIN_IDS.length)).toEqual([
      ...OFFICE_AGENT_ONLY_FORM_IDS,
    ]);
    expect(CHARACTER_FORM_IDS).toContain("secretary");
    expect(new Set(CHARACTER_FORM_IDS).size).toBe(CHARACTER_FORM_IDS.length);
    expect(DEFAULT_FORM_ID).toBe("standard");
  });

  test("every form has a label", () => {
    for (const id of CHARACTER_FORM_IDS)
      expect(CHARACTER_FORM_LABELS[id].length).toBeGreaterThan(0);
    expect(CHARACTER_FORM_LABELS.secretary).toBe("Secretary");
  });

  test("ids from the wire: known forms pass, anything else is the standard jumpsuit", () => {
    expect(isCharacterFormId("secretary")).toBe(true);
    expect(isCharacterFormId("pirate")).toBe(false);
    expect(formIdFor("secretary")).toBe("secretary");
    expect(formIdFor("chef")).toBe("chef");
    expect(formIdFor("pirate")).toBe("standard");
    expect(formIdFor(undefined)).toBe("standard");
  });

  test("an office-agent form is not a henchman skin: no skin rule can assign it", () => {
    for (const id of OFFICE_AGENT_ONLY_FORM_IDS) {
      expect(isHenchmanSkinId(id)).toBe(false);
      expect(CreateSkinRule.safeParse({ match: "provider:codex", skinId: id }).success).toBe(false);
    }
  });
});
