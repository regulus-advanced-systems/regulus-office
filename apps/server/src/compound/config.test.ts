import { describe, expect, test } from "bun:test";
import { CompoundConfigError, loadCompoundConfig } from "./config.ts";

describe("compound config", () => {
  test("defaults: a 20 s build phase, a 64-tile compound and a 60 s blast door", () => {
    expect(loadCompoundConfig({})).toEqual({
      buildMs: 20_000,
      sizeTiles: 64,
      blastDoorMs: 60_000,
    });
    expect(
      loadCompoundConfig({ OFFICE_ROOM_BUILD_SECONDS: " ", OFFICE_COMPOUND_SIZE: "" }),
    ).toEqual({
      buildMs: 20_000,
      sizeTiles: 64,
      blastDoorMs: 60_000,
    });
  });

  test("reads every setting; fractions of a second are fine for tests", () => {
    expect(
      loadCompoundConfig({
        OFFICE_ROOM_BUILD_SECONDS: "0.25",
        OFFICE_COMPOUND_SIZE: "96",
        OFFICE_BLAST_DOOR_SECONDS: "12.5",
      }),
    ).toEqual({ buildMs: 250, sizeTiles: 96, blastDoorMs: 12_500 });
  });

  test.each([
    { OFFICE_ROOM_BUILD_SECONDS: "-1" },
    { OFFICE_ROOM_BUILD_SECONDS: "lots" },
    { OFFICE_COMPOUND_SIZE: "32" },
    { OFFICE_COMPOUND_SIZE: "300" },
    { OFFICE_COMPOUND_SIZE: "64.5" },
    { OFFICE_BLAST_DOOR_SECONDS: "1" },
    { OFFICE_BLAST_DOOR_SECONDS: "601" },
  ])("refuses %o", (env) => {
    expect(() => loadCompoundConfig(env)).toThrow(CompoundConfigError);
  });
});
