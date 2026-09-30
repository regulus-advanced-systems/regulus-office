import { describe, expect, test } from "bun:test";
import {
  checkSandboxSettings,
  DEFAULT_SANDBOX_SETTINGS,
  formatPorts,
  parsePorts,
  pickSlot,
  portRange,
  sandboxEnv,
  slotOf,
} from "./sandbox.ts";

const s = DEFAULT_SANDBOX_SETTINGS;

describe("sandbox ports (#169)", () => {
  test("slot n owns span ports from base + n*span", () => {
    expect(portRange(0, s)).toEqual({ first: 20_000, last: 20_009 });
    expect(portRange(7, s)).toEqual({ first: 20_070, last: 20_079 });
    expect(portRange(s.portSlots - 1, s).last).toBe(39_999);
    expect(() => portRange(s.portSlots, s)).toThrow();
    expect(() => portRange(-1, s)).toThrow();
  });

  test("slotOf inverts portRange and rejects foreign ranges", () => {
    expect(slotOf(portRange(42, s), s)).toBe(42);
    expect(slotOf({ first: 20_001, last: 20_010 }, s)).toBeNull();
    expect(slotOf({ first: 3000, last: 3009 }, s)).toBeNull();
    expect(slotOf({ first: 20_000, last: 20_005 }, s)).toBeNull();
  });

  test("an agent keeps its preferred slot, and collisions take the next free one", () => {
    const first = pickSlot("agent-1", new Set(), s);
    expect(pickSlot("agent-1", new Set(), s)).toBe(first);
    const next = pickSlot("agent-1", new Set([first]), s);
    expect(next).toBe((first + 1) % s.portSlots);
    const tiny = { ...s, portSlots: 2 };
    expect(() => pickSlot("x", new Set([0, 1]), tiny)).toThrow(/in use/);
  });

  test("PORT is the first port of the range", () => {
    expect(sandboxEnv({ first: 20_010, last: 20_019 })).toEqual({
      PORT: "20010",
      OFFICE_SANDBOX_PORTS: "20010-20019",
    });
    expect(parsePorts(formatPorts({ first: 20_010, last: 20_019 }))).toEqual({
      first: 20_010,
      last: 20_019,
    });
    expect(parsePorts("x")).toBeNull();
    expect(parsePorts("5-4")).toBeNull();
    expect(parsePorts(undefined)).toBeNull();
  });

  test("defaults fit the 16 GB / 8 vCPU office VM, and bad plans are refused", () => {
    expect(s.memoryBytes).toBe(2 * 1024 ** 3);
    expect(s.cpus).toBe(2);
    expect(s.pids).toBe(1024);
    expect(checkSandboxSettings({ ...s })).toEqual(s);
    expect(() => checkSandboxSettings({ ...s, portBase: 60_000, portSlots: 1000 })).toThrow();
    expect(() => checkSandboxSettings({ ...s, cpus: 0 })).toThrow();
    expect(() => checkSandboxSettings({ ...s, portBase: 80 })).toThrow();
  });
});
