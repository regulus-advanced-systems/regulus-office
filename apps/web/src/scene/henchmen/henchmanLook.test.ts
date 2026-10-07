import { describe, expect, test } from "bun:test";
import { PROVIDER_LIGHT_COLORS } from "../avatar/index.ts";
import { henchmanSkinLook } from "./henchmanLook.ts";

describe("henchman look (#184)", () => {
  test("the published skin, the provider's colour as trim and the agent id as the seed", () => {
    expect(henchmanSkinLook({ agentId: "a1", provider: "codex", skin: "standard" })).toEqual({
      skin: "standard",
      trim: PROVIDER_LIGHT_COLORS.codex,
      seed: "a1",
    });
    expect(henchmanSkinLook({ agentId: "a2", provider: "claude-code", skin: "chef" })).toEqual({
      skin: "chef",
      trim: PROVIDER_LIGHT_COLORS["claude-code"],
      seed: "a2",
    });
  });
});
