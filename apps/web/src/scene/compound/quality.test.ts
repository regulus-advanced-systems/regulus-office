import { describe, expect, test } from "bun:test";
import {
  effectiveQuality,
  forQuality,
  LOW_DETAIL_SKIP,
  QUALITY_PRESETS,
  qualityFor,
  tierFor,
} from "./quality.ts";

describe("render detail presets (#186, #190, SPEC §11)", () => {
  test("software WebGL gets low; integrated GPUs medium; discrete GPUs high", () => {
    expect(tierFor("ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)))")).toBe("low");
    expect(tierFor("llvmpipe (LLVM 17.0.6, 256 bits)")).toBe("low");
    expect(tierFor("ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0)")).toBe(
      "medium",
    );
    expect(tierFor("ANGLE (Intel, Mesa Intel(R) UHD Graphics 620 (KBL GT2), OpenGL 4.6)")).toBe(
      "medium",
    );
    expect(tierFor("ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11 vs_5_0 ps_5_0)")).toBe("medium");
    expect(tierFor("AMD Radeon Vega 8 Graphics")).toBe("medium");
    expect(tierFor("Mali-G78")).toBe("medium");
    expect(tierFor("")).toBe("medium");
    expect(tierFor("ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 SUPER Direct3D11)")).toBe("high");
    expect(tierFor("ANGLE (AMD, AMD Radeon RX 6700 XT Direct3D11)")).toBe("high");
    expect(tierFor("ANGLE (Intel, Intel(R) Arc(TM) A770 Graphics Direct3D11)")).toBe("high");
    expect(tierFor("Apple M1")).toBe("high");
  });

  test("the query overrides the detection and the Settings choice", () => {
    expect(qualityFor("SwiftShader", "?quality=high")).toBe("high");
    expect(qualityFor("Iris Xe", "?stats&quality=low")).toBe("low");
    expect(qualityFor("Iris Xe", "?quality=medium")).toBe("medium");
    expect(qualityFor("Iris Xe", "?quality=ultra")).toBe("medium");
    expect(effectiveQuality("medium", "auto", "")).toBe("medium");
    expect(effectiveQuality("medium", "high", "")).toBe("high");
    expect(effectiveQuality("high", "low", "?quality=medium")).toBe("medium");
    expect(effectiveQuality("low", undefined, "")).toBe("low");
  });

  test("each preset costs no more than the one above it", () => {
    const { low, medium, high } = QUALITY_PRESETS;
    expect(high.antialias).toBe(true);
    expect(medium.antialias).toBe(false);
    expect(low.antialias).toBe(false);
    expect(low.lampLights).toBeLessThan(medium.lampLights);
    expect(medium.lampLights).toBeLessThan(high.lampLights);
    expect(low.resolutionScale).toBeLessThan(1);
    expect(medium.resolutionScale).toBe(1);
    expect(low.drawDistance).not.toBeNull();
    expect(medium.drawDistance).toBeNull();
    expect(medium.dropDecor).toBe(false);
    expect(low.dropDecor).toBe(true);
  });

  test("dropping decor leaves fixtures and decor out, never furniture or structure", () => {
    const items = (["pipe_run", "pod_desk", "wall_rock", "desk_mugs", "swivel_chair"] as const).map(
      (piece) => ({ piece, position: [0, 0, 0] as const }),
    );
    expect(forQuality(items, false)).toBe(items);
    expect(forQuality(items, true).map((p) => p.piece)).toEqual([
      "pod_desk",
      "wall_rock",
      "swivel_chair",
    ]);
    for (const kept of ["pod_desk", "wall_rock", "door_frame_wide", "laptop"] as const)
      expect(LOW_DETAIL_SKIP.has(kept)).toBe(false);
  });
});
