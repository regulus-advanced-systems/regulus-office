import { describe, expect, test } from "bun:test";
import { findPath } from "../astar.ts";
import { HEADING } from "../geometry.ts";
import { buildNavGrid } from "../nav-grid.ts";
import { anchorSpan, deskSeats, interactables, wallById, wallLength } from "../query.ts";
import { FLOOR_TIERS, FloorTemplateSchema } from "../types.ts";
import { structuralProblems, templateProblems } from "../validate.ts";
import { largeTemplateInput } from "./large.ts";
import { lobbyTemplateInput } from "./lobby.ts";
import { officeL2TemplateInput } from "./office-l2.ts";
import { smallTemplateInput } from "./small.ts";
import {
  DESKS_PER_TIER,
  nextTier,
  TEMPLATES,
  TIER_ORDER,
  templateById,
  templateForTier,
  tierForDeskCount,
} from "./tiers.ts";

const all = [...TEMPLATES.values()];
const inputs = [lobbyTemplateInput, smallTemplateInput, officeL2TemplateInput, largeTemplateInput];

describe("every template", () => {
  test("registry holds the lobby and one template per tier", () => {
    expect(all.map((t) => t.id)).toEqual(["lobby", "office-small", "office-l2", "office-large"]);
    expect(all.map((t) => t.kind)).toEqual(["lobby", ...FLOOR_TIERS]);
  });

  test.each(inputs.map((i) => [i.id, i] as const))(
    "%s parses with the zod schema",
    (_id, input) => {
      expect(FloorTemplateSchema.safeParse(input).success).toBe(true);
    },
  );

  test.each(all.map((t) => [t.id, t] as const))(
    "%s has no structural or nav problems",
    (_id, t) => {
      expect(structuralProblems(t)).toEqual([]);
      expect(templateProblems(t)).toEqual([]);
    },
  );

  test.each(all.map((t) => [t.id, t] as const))("%s has unique ids", (_id, t) => {
    const ids = [
      ...t.walls.map((w) => w.id),
      ...t.seats.map((s) => s.id),
      ...t.wallAnchors.map((a) => a.id),
      ...t.obstacles.map((o) => o.id),
    ];
    expect(new Set(ids).size).toBe(ids.length);
  });

  test.each(all.map((t) => [t.id, t] as const))(
    "%s: no seat or spawn on a blocked cell",
    (_id, t) => {
      const grid = buildNavGrid(t);
      expect(grid.isWalkable(t.spawn.x, t.spawn.z)).toBe(true);
      expect(grid.isWalkable(t.elevator.door.x, t.elevator.door.z)).toBe(true);
      for (const seat of t.seats) expect(grid.isWalkable(seat.pose.x, seat.pose.z)).toBe(true);
    },
  );

  test.each(all.map((t) => [t.id, t] as const))(
    "%s: every wall anchor lies on a full wall",
    (_id, t) => {
      expect(t.wallAnchors.length).toBeGreaterThan(0);
      for (const anchor of t.wallAnchors) {
        const wall = wallById(t, anchor.wallId);
        expect(wall).toBeDefined();
        if (!wall) continue;
        expect(wall.height).toBe("full");
        const span = anchorSpan(anchor);
        expect(span.start).toBeGreaterThanOrEqual(0);
        expect(span.end).toBeLessThanOrEqual(wallLength(wall));
        expect(anchor.y - anchor.h / 2).toBeGreaterThanOrEqual(0);
        expect(anchor.y + anchor.h / 2).toBeLessThanOrEqual(t.wallHeight);
      }
    },
  );

  test.each(all.map((t) => [t.id, t] as const))(
    "%s: A* reaches every seat and interactable from spawn",
    (_id, t) => {
      const grid = buildNavGrid(t);
      const start = grid.worldToCell(t.spawn.x, t.spawn.z);
      const targets = [...t.seats.map((s) => s.pose), ...interactables(t).map((i) => i.standAt)];
      expect(targets.length).toBeGreaterThan(t.seats.length);
      for (const target of targets) {
        const path = findPath(grid, start, grid.worldToCell(target.x, target.z));
        expect(path).not.toBeNull();
      }
    },
  );

  test.each(all.map((t) => [t.id, t] as const))(
    "%s: seats and stand points sit on nav cell centres (paths end exactly there)",
    (_id, t) => {
      const grid = buildNavGrid(t);
      const points = [...t.seats.map((s) => s.pose), ...interactables(t).map((i) => i.standAt)];
      for (const p of points) {
        expect(grid.cellToWorld(grid.worldToCell(p.x, p.z))).toEqual({ x: p.x, z: p.z });
      }
    },
  );

  test.each(all.map((t) => [t.id, t] as const))("%s: spawn is at the elevator doors", (_id, t) => {
    expect(t.spawn).toEqual(t.elevator.door);
    expect(t.nameWallId).toBe("south");
    expect(wallById(t, t.nameWallId)?.height).toBe("stub");
  });
});

describe("tiers", () => {
  test.each([...FLOOR_TIERS])("%s template has exactly the tier's desk count", (tier) => {
    const t = templateForTier(tier);
    expect(t.kind).toBe(tier);
    expect(deskSeats(t)).toHaveLength(DESKS_PER_TIER[tier]);
  });

  test("desk counts match SPEC §9.1 and grow with the tier", () => {
    expect(DESKS_PER_TIER).toEqual({ small: 6, medium: 12, large: 20 });
    expect(TIER_ORDER).toEqual(["small", "medium", "large"]);
    expect(tierForDeskCount(1)).toBe("small");
    expect(tierForDeskCount(6)).toBe("small");
    expect(tierForDeskCount(7)).toBe("medium");
    expect(tierForDeskCount(20)).toBe("large");
    expect(tierForDeskCount(21)).toBeUndefined();
    expect(nextTier("small")).toBe("medium");
    expect(nextTier("large")).toBeUndefined();
  });

  test("templateById resolves ids and rejects unknown ones", () => {
    expect(templateById("office-l2")?.name).toBe("Office L2");
    expect(templateById("nope")).toBeUndefined();
  });

  test.each([...FLOOR_TIERS])(
    "%s template has the boards, whiteboard, usage wall and pictures",
    (tier) => {
      const kinds = templateForTier(tier).wallAnchors.map((a) => a.kind);
      for (const k of ["issue_board", "pr_board", "queue_clipboard", "whiteboard", "usage_wall"]) {
        expect(kinds.filter((x) => x === k)).toHaveLength(1);
      }
      expect(kinds.filter((k) => k === "picture").length).toBeGreaterThanOrEqual(1);
    },
  );

  test.each([...FLOOR_TIERS])("%s template has GDT office furniture", (tier) => {
    const kinds = new Set(templateForTier(tier).obstacles.map((o) => o.kind));
    for (const k of ["shared_table", "ceo_desk", "cabinet", "counter", "coffee_machine", "plant"]) {
      expect(kinds.has(k as never)).toBe(true);
    }
  });

  test("office L2 has two shared tables with four seats each, a CEO L-desk and a meeting table", () => {
    const t = templateForTier("medium");
    const tables = t.obstacles.filter((o) => o.kind === "shared_table");
    expect(tables).toHaveLength(2);
    for (const table of tables) {
      expect(t.seats.filter((s) => s.furnitureId === table.id && s.kind === "desk")).toHaveLength(
        4,
      );
    }
    expect(t.obstacles.filter((o) => o.kind === "ceo_desk")).toHaveLength(2);
    expect(t.seats.filter((s) => s.furnitureId === "ceo-main")).toHaveLength(1);
    expect(t.seats.filter((s) => s.furnitureId === "meeting-table")).toHaveLength(6);
    expect(t.walls.find((w) => w.id === "north")?.openings.length).toBe(4);
  });

  test("large office has two pods split by a partition", () => {
    const t = templateForTier("large");
    const partition = t.walls.find((w) => w.id === "partition");
    expect(partition?.height).toBe("full");
    const splitX = partition?.from.x ?? 0;
    expect(partition?.to.x).toBe(splitX);
    const west = deskSeats(t).filter((s) => s.pose.x < splitX);
    const east = deskSeats(t).filter((s) => s.pose.x > splitX);
    expect(west).toHaveLength(10);
    expect(east).toHaveLength(10);
  });
});

describe("lobby", () => {
  const lobby = templateById("lobby");
  if (!lobby) throw new Error("lobby missing");

  test("has no agent desks but a reception seat and couch seats", () => {
    expect(deskSeats(lobby)).toHaveLength(0);
    expect(lobby.seats.filter((s) => s.kind === "reception")).toHaveLength(1);
    expect(lobby.seats.filter((s) => s.kind === "couch").length).toBeGreaterThanOrEqual(2);
  });

  test("has the SPEC §9.1 lobby fixtures", () => {
    const anchors = lobby.wallAnchors.map((a) => a.kind);
    expect(anchors).toContain("usage_wall");
    expect(anchors).toContain("tv");
    expect(anchors).toContain("whiteboard");
    const kinds: string[] = lobby.obstacles.map((o) => o.kind);
    for (const k of ["reception_desk", "jukebox", "coffee_machine", "couch", "plant"]) {
      expect(kinds).toContain(k);
    }
    const ids = interactables(lobby).map((i) => i.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "elevator",
        "reception-desk",
        "jukebox",
        "coffee-machine",
        "lounge-tv",
      ]),
    );
  });

  test("the atrium keeps the middle open, on a rug, with a planter island nearby", () => {
    const centre = { x: lobby.size.width / 2, z: lobby.size.depth / 2 };
    expect(buildNavGrid(lobby).isWalkable(centre.x, centre.z)).toBe(true);
    const rug = lobby.rugs.find((r) => r.id === "atrium-rug");
    expect(rug).toBeDefined();
    if (!rug) return;
    expect(centre.x).toBeGreaterThan(rug.rect.x);
    expect(centre.x).toBeLessThan(rug.rect.x + rug.rect.w);
    expect(centre.z).toBeGreaterThan(rug.rect.z);
    expect(centre.z).toBeLessThan(rug.rect.z + rug.rect.d);
    const island = lobby.obstacles.find((o) => o.kind === "planter");
    expect(island).toBeDefined();
    if (!island) return;
    // Clear of the e2e click point (tolerance 0.75 m) by a lane width.
    expect(island.rect.z - centre.z).toBeGreaterThanOrEqual(1.5);
  });

  test("couch seats face the TV and the PM robot faces the room", () => {
    for (const seat of lobby.seats.filter((s) => s.furnitureId === "couch")) {
      expect(seat.pose.heading).toBe(HEADING.west);
    }
    expect(lobby.seats.find((s) => s.kind === "reception")?.pose.heading).toBe(HEADING.south);
  });
});
