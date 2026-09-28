import { describe, expect, test } from "bun:test";
import { mayControlTerminal } from "./access.ts";

describe("mayControlTerminal (D12)", () => {
  test("owner/admin always, robot owner if member, never viewers or strangers", () => {
    expect(mayControlTerminal({ id: "o", role: "owner" }, "x")).toBe(true);
    expect(mayControlTerminal({ id: "a", role: "admin" }, "x")).toBe(true);
    expect(mayControlTerminal({ id: "m", role: "member" }, "m")).toBe(true);
    expect(mayControlTerminal({ id: "m", role: "member" }, "x")).toBe(false);
    expect(mayControlTerminal({ id: "v", role: "viewer" }, "v")).toBe(false);
    expect(mayControlTerminal({ id: "m", role: "member" }, undefined)).toBe(false);
    expect(mayControlTerminal(null, "x")).toBe(false);
  });
});
