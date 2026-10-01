import { describe, expect, test } from "bun:test";
import { forQuality, LOW_DETAIL_SKIP, qualityFor } from "./quality.ts";

describe("render detail (#186, SPEC §11)", () => {
  test("software WebGL gets the low tier; a GPU the high one; the query overrides", () => {
    expect(qualityFor("ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)))", "")).toBe(
      "low",
    );
    expect(qualityFor("llvmpipe (LLVM 17.0.6, 256 bits)", "")).toBe("low");
    expect(qualityFor("ANGLE (Intel, Intel(R) Iris(R) Xe Graphics)", "")).toBe("high");
    expect(qualityFor("", "")).toBe("high");
    expect(qualityFor("SwiftShader", "?quality=high")).toBe("high");
    expect(qualityFor("Iris Xe", "?stats&quality=low")).toBe("low");
  });

  test("the low tier drops fixtures and decor, never furniture or structure", () => {
    const items = (["pipe_run", "pod_desk", "wall_rock", "desk_mugs", "swivel_chair"] as const).map(
      (piece) => ({ piece, position: [0, 0, 0] as const }),
    );
    expect(forQuality(items, "high")).toBe(items);
    expect(forQuality(items, "low").map((p) => p.piece)).toEqual([
      "pod_desk",
      "wall_rock",
      "swivel_chair",
    ]);
    for (const kept of ["pod_desk", "wall_rock", "door_frame_wide", "laptop"] as const)
      expect(LOW_DETAIL_SKIP.has(kept)).toBe(false);
  });
});
