import { describe, expect, test } from "bun:test";
import {
  CreateSkinRule,
  DEFAULT_SKIN_ID,
  HENCHMAN_SKIN_IDS,
  HENCHMAN_SKIN_LABELS,
  parseSkinMatch,
  rankSkinRules,
  resolveSkin,
  type SkinRule,
  skinIdFor,
  skinRuleMatches,
  UpdateSkinRule,
} from "./skins.ts";

const rule = (id: string, match: string, skinId: SkinRule["skinId"], priority = 0, createdAt = 1) =>
  ({ id, match, skinId, priority, createdAt }) satisfies SkinRule;

describe("henchman skins (#184)", () => {
  test("a built-in set of at least four special skins besides the standard jumpsuit", () => {
    expect<string | undefined>(HENCHMAN_SKIN_IDS[0]).toBe(DEFAULT_SKIN_ID);
    expect(HENCHMAN_SKIN_IDS.length).toBeGreaterThanOrEqual(5);
    for (const id of HENCHMAN_SKIN_IDS) expect(HENCHMAN_SKIN_LABELS[id].length).toBeGreaterThan(0);
    expect(skinIdFor("chef")).toBe("chef");
    expect(skinIdFor("pirate")).toBe("standard");
    expect(skinIdFor(undefined)).toBe("standard");
  });

  test("rule matches parse: role:pm, office_agent:<id>, provider:<id>", () => {
    expect(parseSkinMatch("role:pm")).toEqual({ kind: "role", value: "pm" });
    expect(parseSkinMatch("office_agent:hermes-1")).toEqual({
      kind: "office_agent",
      value: "hermes-1",
    });
    expect(parseSkinMatch("provider:codex")).toEqual({ kind: "provider", value: "codex" });
    for (const bad of ["", "pm", "role:", "role:ceo", "provider:gpt", "office_agent:", "user:u1"])
      expect(parseSkinMatch(bad)).toBeNull();
    expect(skinRuleMatches("provider:codex", { provider: "codex" })).toBe(true);
    expect(skinRuleMatches("provider:codex", { provider: "claude-code" })).toBe(false);
    expect(skinRuleMatches("role:pm", { role: "pm" })).toBe(true);
    expect(skinRuleMatches("role:pm", { provider: "codex" })).toBe(false);
    expect(skinRuleMatches("office_agent:a1", { officeAgentId: "a1", role: "pm" })).toBe(true);
    expect(skinRuleMatches("office_agent:a1", { officeAgentId: "a2" })).toBe(false);
  });

  test("no matching rule: the standard jumpsuit", () => {
    expect(resolveSkin([], { provider: "codex" })).toBe("standard");
    expect(resolveSkin([rule("r1", "role:pm", "number_two")], { provider: "codex" })).toBe(
      "standard",
    );
  });

  test("the highest priority wins, then the more specific match, then the older rule", () => {
    const pm = { role: "pm" as const, officeAgentId: "pm-1", provider: "claude-code" as const };
    // Priority beats specificity.
    expect(
      resolveSkin(
        [
          rule("a", "office_agent:pm-1", "chef", 0),
          rule("b", "provider:claude-code", "lab_coat", 3),
        ],
        pm,
      ),
    ).toBe("lab_coat");
    // Equal priority: office agent > role > provider.
    const equal = [
      rule("p", "provider:claude-code", "lab_coat"),
      rule("r", "role:pm", "number_two"),
      rule("o", "office_agent:pm-1", "black_ops"),
    ];
    expect(resolveSkin(equal, pm)).toBe("black_ops");
    expect(resolveSkin(equal, { ...pm, officeAgentId: "pm-2" })).toBe("number_two");
    expect(resolveSkin(equal, { provider: "claude-code" })).toBe("lab_coat");
    // Same priority and kind: the older rule; same age: by id, so the order is stable.
    expect(
      resolveSkin(
        [rule("x", "provider:codex", "chef", 0, 5), rule("y", "provider:codex", "lab_coat", 0, 2)],
        {
          provider: "codex",
        },
      ),
    ).toBe("lab_coat");
    expect(
      rankSkinRules([rule("b", "role:pm", "chef"), rule("a", "role:pm", "chef")]).map((r) => r.id),
    ).toEqual(["a", "b"]);
    // An explicit standard rule can shadow a lower one.
    expect(
      resolveSkin(
        [rule("s", "provider:codex", "standard", 9), rule("c", "provider:codex", "chef", 1)],
        {
          provider: "codex",
        },
      ),
    ).toBe("standard");
  });

  test("request shapes", () => {
    expect(CreateSkinRule.parse({ match: "role:pm", skinId: "number_two" })).toEqual({
      match: "role:pm",
      skinId: "number_two",
      priority: 0,
    });
    expect(CreateSkinRule.safeParse({ match: "role:boss", skinId: "chef" }).success).toBe(false);
    expect(CreateSkinRule.safeParse({ match: "role:pm", skinId: "clown" }).success).toBe(false);
    expect(UpdateSkinRule.safeParse({}).success).toBe(false);
    expect(UpdateSkinRule.parse({ priority: -3 })).toEqual({ priority: -3 });
  });
});
