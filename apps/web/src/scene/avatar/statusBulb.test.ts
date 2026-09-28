import { describe, expect, test } from "bun:test";
import { AGENT_STATUSES } from "@regulus/protocol";
import { colors } from "../../ui/theme.ts";
import {
  BULB_COLORS,
  bulbColorFor,
  bulbLitFor,
  handRaisedFor,
  NEUTRAL_BULB_COLOR,
} from "./statusBulb.ts";

describe("statusBulb", () => {
  test("every agent status has a bulb colour", () => {
    for (const status of AGENT_STATUSES) expect(BULB_COLORS[status]).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });

  test("SPEC §9.3 colours: grey starting, green idle, blue working, orange waiting, red error, dark exited", () => {
    expect(bulbColorFor("starting")).toBe("#9E9E9E");
    expect(bulbColorFor("idle")).toBe("#3DCB6A");
    expect(bulbColorFor("working")).toBe(colors.blue);
    expect(bulbColorFor("waiting_permission")).toBe(colors.amber);
    expect(bulbColorFor("error")).toBe("#E53935");
    expect(bulbColorFor("exited")).toBe("#2B2B2B");
  });

  test("statuses outside the spec list map to the nearest listed one", () => {
    expect(bulbColorFor("waiting_input")).toBe(bulbColorFor("waiting_permission"));
    expect(bulbColorFor("done")).toBe(bulbColorFor("idle"));
    expect(bulbColorFor("offline")).toBe(bulbColorFor("exited"));
  });

  test("no status gives the neutral bulb", () => {
    expect(bulbColorFor(undefined)).toBe(NEUTRAL_BULB_COLOR);
  });

  test("only waiting statuses raise the hand; dark statuses are unlit", () => {
    expect(AGENT_STATUSES.filter(handRaisedFor)).toEqual(["waiting_permission", "waiting_input"]);
    expect(AGENT_STATUSES.filter((s) => !bulbLitFor(s))).toEqual(["exited", "offline"]);
    expect(handRaisedFor(undefined)).toBe(false);
  });
});
