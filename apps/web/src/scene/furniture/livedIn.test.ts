import { describe, expect, test } from "bun:test";
import { largeTemplate, officeL2Template } from "@regulus/room-layout";
import {
  BOOK_COLORS,
  planterPlants,
  propPlacements,
  shelfBooks,
  surfaceHeight,
} from "./livedIn.ts";

describe("shelfBooks", () => {
  test("books stay inside the shelf and are deterministic", () => {
    const books = shelfBooks(1.4, 1.8);
    expect(books.length).toBeGreaterThan(20);
    expect(shelfBooks(1.4, 1.8)).toEqual(books);
    for (const b of books) {
      expect(b.x - b.w / 2).toBeGreaterThanOrEqual(-0.7);
      expect(b.x + b.w / 2).toBeLessThanOrEqual(0.7);
      expect(b.y + b.h).toBeLessThanOrEqual(1.8);
      expect(BOOK_COLORS).toContain(b.color);
    }
  });
});

describe("planterPlants", () => {
  test("spreads plants along the long side inside the box", () => {
    const rect = { x: 13.3, z: 5, w: 0.55, d: 2 };
    const plants = planterPlants(rect);
    expect(plants).toHaveLength(3);
    for (const p of plants) {
      expect(p.x).toBeGreaterThanOrEqual(rect.x);
      expect(p.x + p.w).toBeLessThanOrEqual(rect.x + rect.w);
      expect(p.z).toBeGreaterThanOrEqual(rect.z);
      expect(p.z + p.d).toBeLessThanOrEqual(rect.z + rect.d);
    }
  });
});

describe("propPlacements", () => {
  test("props stand on their furniture's top surface", () => {
    const placed = propPlacements(officeL2Template);
    expect(placed).toHaveLength(officeL2Template.decor.length);
    const plant = placed.find((p) => p.decor.id === "desk-1-plant");
    expect(plant?.position[1]).toBe(surfaceHeight("desk"));
    const mugs = placed.find((p) => p.decor.kind === "mugs");
    expect(mugs?.position[1]).toBe(surfaceHeight("bistro_table"));
  });

  test("the large floor's props all find their furniture", () => {
    expect(propPlacements(largeTemplate)).toHaveLength(largeTemplate.decor.length);
  });
});
