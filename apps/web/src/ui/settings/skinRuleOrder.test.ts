import { describe, expect, test } from "bun:test";
import { resolveSkin, type SkinRule } from "@regulus/protocol";
import { moveRule, orderedRules, priorityPatches } from "./skinRuleOrder.ts";

const rule = (id: string, match: string, priority: number, createdAt = 1) =>
  ({ id, match, skinId: "chef", priority, createdAt }) as SkinRule;

describe("skin rule order (#225)", () => {
  test("shown in the server's ranking", () => {
    const rules = [
      rule("a", "provider:codex", 0),
      rule("b", "role:pm", 0),
      rule("c", "provider:codex", 4),
    ];
    expect(orderedRules(rules).map((r) => r.id)).toEqual(["c", "b", "a"]);
  });

  test("moveRule clamps at the ends", () => {
    expect(moveRule(["a", "b", "c"], 2, -1)).toEqual(["a", "c", "b"]);
    expect(moveRule(["a", "b", "c"], 0, -1)).toEqual(["a", "b", "c"]);
    expect(moveRule(["a", "b", "c"], 0, 1)).toEqual(["b", "a", "c"]);
  });

  test("priorities n-1 … 0 from the top; only changed ones are sent", () => {
    expect(
      priorityPatches([
        rule("a", "provider:codex", 2),
        rule("b", "role:pm", 1),
        rule("c", "role:pm", 0),
      ]),
    ).toEqual([]);
    expect(
      priorityPatches([
        rule("c", "role:pm", 0),
        rule("a", "provider:codex", 2),
        rule("b", "role:pm", 1),
      ]),
    ).toEqual([
      { id: "c", priority: 2 },
      { id: "a", priority: 1 },
      { id: "b", priority: 0 },
    ]);
  });

  test("after the patches, the top matching rule is the one the server resolves", () => {
    // A provider rule moved above the more specific office-agent rule wins once priorities follow the order.
    const order = [rule("p", "provider:codex", 0), rule("o", "office_agent:x", 0)];
    const patched = order.map((r) => ({
      ...r,
      priority: priorityPatches(order).find((p) => p.id === r.id)?.priority ?? r.priority,
      skinId: r.id === "p" ? ("lab_coat" as const) : ("chef" as const),
    }));
    expect(resolveSkin(patched, { provider: "codex", officeAgentId: "x" })).toBe("lab_coat");
  });
});
