import { describe, expect, test } from "bun:test";
import { diffStat, lineDiff } from "./line-diff.ts";
import {
  CreateMindEntry,
  mayReadOfficeAgentMind,
  OFFICE_AGENT_MIND_LIMITS,
  officeAgentMindPaths,
  SaveOfficeAgentSoul,
} from "./office-agent-mind.ts";
import { OFFICE_TOOL_INPUTS, toolsForPreset } from "./office-agent-tools.ts";
import { mayRemoveOfficeAgent } from "./office-agents.ts";

const people = {
  owner: { id: "olga", role: "owner" },
  admin: { id: "ada", role: "admin" },
  member: { id: "mia", role: "member" },
  other: { id: "sam", role: "member" },
  viewer: { id: "vic", role: "viewer" },
} as const;

describe("who may read an agent's soul, memories and notes (D20)", () => {
  test("a personal agent's: only the person it belongs to, whatever anyone's office role", () => {
    const mias = { ownerUserId: "mia" };
    expect(mayReadOfficeAgentMind(people.member, mias)).toBe(true);
    for (const who of [people.owner, people.admin, people.other, people.viewer]) {
      expect(mayReadOfficeAgentMind(who, mias)).toBe(false);
    }
    // Also when the agent belongs to an admin or the office owner: nobody else, not each other.
    expect(mayReadOfficeAgentMind(people.owner, { ownerUserId: "ada" })).toBe(false);
    expect(mayReadOfficeAgentMind(people.admin, { ownerUserId: "olga" })).toBe(false);
    expect(mayReadOfficeAgentMind(people.admin, { ownerUserId: "ada" })).toBe(true);
  });

  test("a shared agent's: office owners and admins", () => {
    const shared = { ownerUserId: null };
    expect(mayReadOfficeAgentMind(people.owner, shared)).toBe(true);
    expect(mayReadOfficeAgentMind(people.admin, shared)).toBe(true);
    for (const who of [people.member, people.other, people.viewer]) {
      expect(mayReadOfficeAgentMind(who, shared)).toBe(false);
    }
  });

  test("admins may remove a personal agent they cannot read; other members may not", () => {
    const mias = { ownerUserId: "mia" };
    expect(mayRemoveOfficeAgent(people.member, mias)).toBe(true);
    expect(mayRemoveOfficeAgent(people.admin, mias)).toBe(true);
    expect(mayRemoveOfficeAgent(people.owner, mias)).toBe(true);
    expect(mayRemoveOfficeAgent(people.other, mias)).toBe(false);
    expect(mayRemoveOfficeAgent(people.member, { ownerUserId: null })).toBe(false);
  });
});

describe("shapes and tools", () => {
  test("paths, caps and inputs", () => {
    expect(officeAgentMindPaths("a b").soulVersion(3)).toBe(
      "/api/office-agents/a%20b/soul/versions/3",
    );
    const { soulMax, memoryTextMax } = OFFICE_AGENT_MIND_LIMITS;
    expect(SaveOfficeAgentSoul.safeParse({ content: "x".repeat(soulMax + 1) }).success).toBe(false);
    expect(SaveOfficeAgentSoul.safeParse({ content: "" }).success).toBe(true);
    expect(
      CreateMindEntry.safeParse({ kind: "memory", text: "x".repeat(memoryTextMax + 1) }).success,
    ).toBe(false);
    expect(CreateMindEntry.safeParse({ kind: "note", title: "two\nlines", text: "" }).success).toBe(
      false,
    );
    expect(CreateMindEntry.safeParse({ kind: "note", title: "Journal", text: "" }).success).toBe(
      true,
    );
  });

  test("every preset has the memory and note tools, and none of them names an agent", () => {
    const names: string[] = toolsForPreset("observer").map((t) => t.name);
    for (const name of ["soul_read", "memory_save", "memory_search", "memory_list"] as const) {
      expect(names).toContain(name);
      const shape: Record<string, unknown> = OFFICE_TOOL_INPUTS[name].shape;
      expect(Object.keys(shape)).not.toContain("agentId");
    }
    for (const name of ["memory_forget", "note_write", "note_read", "note_list", "note_delete"]) {
      expect(names).toContain(name);
    }
  });
});

describe("line diff", () => {
  test("added, removed and unchanged lines, in order", () => {
    expect(lineDiff("a\nb\nc", "a\nx\nc\nd")).toEqual([
      { t: "same", line: "a" },
      { t: "del", line: "b" },
      { t: "add", line: "x" },
      { t: "same", line: "c" },
      { t: "add", line: "d" },
    ]);
    expect(diffStat("a\nb\nc", "a\nx\nc\nd")).toEqual({ added: 2, removed: 1 });
    expect(diffStat("", "one\ntwo")).toEqual({ added: 2, removed: 0 });
    expect(diffStat("one\ntwo", "")).toEqual({ added: 0, removed: 2 });
    expect(diffStat("same", "same")).toEqual({ added: 0, removed: 0 });
    expect(lineDiff("x\ny", "y\nx").filter((d) => d.t === "same")).toHaveLength(1);
  });
});
