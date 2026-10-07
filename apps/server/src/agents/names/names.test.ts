import { describe, expect, test } from "bun:test";
import { AGENT_NAME_MAX } from "@regulus/protocol";
import { HENCHMAN_NAMES, pickHenchmanName } from "./names.ts";

describe("henchman names", () => {
  test("the list has no duplicates and every name fits a name tag", () => {
    const keys = HENCHMAN_NAMES.map((n) => n.toLowerCase());
    expect(new Set(keys).size).toBe(HENCHMAN_NAMES.length);
    for (const name of HENCHMAN_NAMES) {
      expect(name).toMatch(/^[A-Z][a-z]{2,11}$/);
      expect(name.length + 4).toBeLessThanOrEqual(AGENT_NAME_MAX);
    }
    expect(HENCHMAN_NAMES.length).toBeGreaterThanOrEqual(100);
  });

  test("picks a name nobody holds, whatever the case of the taken ones", () => {
    const names = ["Rivet", "Gasket", "Shim"];
    for (let i = 0; i < 20; i++) {
      expect(pickHenchmanName(["rivet", "SHIM "], () => i / 20, names)).toBe("Gasket");
    }
  });

  test("the random source chooses among the free names", () => {
    const names = ["Rivet", "Gasket", "Shim"];
    expect(pickHenchmanName([], () => 0, names)).toBe("Rivet");
    expect(pickHenchmanName([], () => 0.99, names)).toBe("Shim");
    expect(pickHenchmanName([], () => 1, names)).toBe("Rivet");
  });

  test("with the list used up it numbers a name, lowest free number first", () => {
    const names = ["Rivet", "Gasket"];
    expect(pickHenchmanName(names, () => 0, names)).toBe("Rivet 2");
    expect(pickHenchmanName([...names, "Rivet 2"], () => 0, names)).toBe("Rivet 3");
    expect(pickHenchmanName([...names, "Rivet 2"], () => 0.6, names)).toBe("Gasket 2");
  });

  test("a whole office of henchmen gets distinct names", () => {
    const taken: string[] = [];
    for (let i = 0; i < HENCHMAN_NAMES.length + 40; i++) taken.push(pickHenchmanName(taken));
    expect(new Set(taken.map((n) => n.toLowerCase())).size).toBe(taken.length);
  });
});
