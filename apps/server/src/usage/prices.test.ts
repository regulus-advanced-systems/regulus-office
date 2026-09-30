import { describe, expect, test } from "bun:test";
import { estimateCostUsd, normalizeModel, PRICES, PRICES_AS_OF, priceFor } from "./prices.ts";

describe("price table", () => {
  test("every price names its check date and an https source", () => {
    for (const p of PRICES) {
      expect(p.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(p.source).toMatch(/^https:\/\//);
      expect(p.input).toBeGreaterThan(0);
    }
    expect(PRICES_AS_OF).toBe("2026-09-30");
  });

  test("exact ids, dated ids, platform ids and aliases find the right price", () => {
    expect(priceFor("claude-code", "claude-opus-5-5")?.model).toBe("claude-opus-5-5");
    expect(priceFor("claude-code", "claude-opus-5")?.model).toBe("claude-opus-5");
    expect(priceFor("claude-code", "claude-sonnet-4-5-20250929")?.model).toBe("claude-sonnet-4-5");
    expect(priceFor("claude-code", "claude-opus-4-20250514")?.model).toBe("claude-opus-4");
    expect(priceFor("claude-code", "anthropic.claude-haiku-4-5")?.model).toBe("claude-haiku-4-5");
    expect(priceFor("claude-code", "claude-opus-4-5@20251101")?.model).toBe("claude-opus-4-5");
    expect(priceFor("claude-code", "claude-sonnet-5-5[1m]")?.model).toBe("claude-sonnet-5-5");
    expect(priceFor("claude-code", "opus")?.model).toBe("claude-opus-5-5");
    expect(priceFor("claude-code", "")?.model).toBe("claude-opus-5-5");
    expect(priceFor("codex", "")?.model).toBe("gpt-6-sol");
    expect(normalizeModel("claude-code", "Sonnet")).toBe("claude-sonnet-5-5");
    expect(priceFor("claude-code", "gpt-6-sol")).toBeNull();
    expect(priceFor("codex", "some-new-model")).toBeNull();
  });

  test("math: per-million prices, cache reads and writes priced separately", () => {
    // Opus 5.5: $4 in, $20 out, $0.20 cache read, $5 cache write (5 m).
    const cost = estimateCostUsd("claude-code", "claude-opus-5-5", {
      inputTokens: 1_000_000,
      outputTokens: 100_000,
      cacheReadTokens: 2_000_000,
      cacheWriteTokens: 200_000,
    });
    expect(cost).toBeCloseTo(4 + 2 + 0.4 + 1, 6);
    // gpt-6-sol: $2 in, $10 out, $0.20 cached input.
    const codex = estimateCostUsd("codex", "gpt-6-sol", {
      inputTokens: 500_000,
      outputTokens: 50_000,
      cacheReadTokens: 1_000_000,
      cacheWriteTokens: 0,
    });
    expect(codex).toBeCloseTo(1 + 0.5 + 0.2, 6);
    expect(
      estimateCostUsd("codex", "unknown", {
        inputTokens: 9,
        outputTokens: 9,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      }),
    ).toBe(0);
  });
});
