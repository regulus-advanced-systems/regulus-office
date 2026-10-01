import { describe, expect, test } from "bun:test";
import { DEFAULT_ROOM_SETTINGS, type OperationSummary, UNPLACED_ROOM } from "@regulus/protocol";
import { currentOperationName, LOBBY_NAME } from "./operationName.ts";

const operation = (index: number, name: string): OperationSummary => ({
  operationId: `f${index}`,
  name,
  slug: name.toLowerCase(),
  index,
  paletteId: "teal",
  henchmenWorking: 0,
  henchmenWaiting: 0,
  henchmenTotal: 0,
  humansPresent: 0,
  ...UNPLACED_ROOM,
  ...DEFAULT_ROOM_SETTINGS,
});

describe("currentOperationName", () => {
  const operations = { f0: operation(0, "Ground"), f1: operation(1, "Regulus Web") };
  test("no operation joined means the lobby", () => {
    expect(currentOperationName(operations, null)).toBe(LOBBY_NAME);
    expect(currentOperationName(null, null)).toBe(LOBBY_NAME);
  });
  test("operation 0 is always shown as the lobby", () => {
    expect(currentOperationName(operations, "f0")).toBe(LOBBY_NAME);
  });
  test("other operations show their project name", () => {
    expect(currentOperationName(operations, "f1")).toBe("Regulus Web");
  });
  test("an operation the building has not listed yet shows a placeholder", () => {
    expect(currentOperationName(operations, "missing")).toBe("Room …");
    expect(currentOperationName(null, "f1")).toBe("Room …");
  });
});
