import { describe, expect, test } from "bun:test";
import { CompoundConfigError, loadCompoundConfig } from "./config.ts";

describe("compound config", () => {
  test("defaults: a 20 s build phase and a 64-tile compound", () => {
    expect(loadCompoundConfig({})).toEqual({ buildMs: 20_000, sizeTiles: 64 });
    expect(
      loadCompoundConfig({ OFFICE_ROOM_BUILD_SECONDS: " ", OFFICE_COMPOUND_SIZE: "" }),
    ).toEqual({
      buildMs: 20_000,
      sizeTiles: 64,
    });
  });

  test("reads both settings; fractions of a second are fine for tests", () => {
    expect(
      loadCompoundConfig({ OFFICE_ROOM_BUILD_SECONDS: "0.25", OFFICE_COMPOUND_SIZE: "96" }),
    ).toEqual({ buildMs: 250, sizeTiles: 96 });
  });

  test.each([
    { OFFICE_ROOM_BUILD_SECONDS: "-1" },
    { OFFICE_ROOM_BUILD_SECONDS: "lots" },
    { OFFICE_COMPOUND_SIZE: "32" },
    { OFFICE_COMPOUND_SIZE: "300" },
    { OFFICE_COMPOUND_SIZE: "64.5" },
  ])("refuses %o", (env) => {
    expect(() => loadCompoundConfig(env)).toThrow(CompoundConfigError);
  });
});
