/**
 * Template validation: zod shape checks, then structural checks (references,
 * bounds, anchors on walls) and navigation checks (seats and interactables on
 * walkable cells, all reachable from the spawn point). `loadTemplate` runs all
 * three and throws, so a bad template fails at import time rather than in a room.
 */
import { type Rect, rectContains, rectInside, rectsOverlap, spansOverlap } from "./geometry.ts";
import { buildNavGrid, type NavGrid } from "./nav-grid.ts";
import { anchorSpan, interactables, rectSpanOnWall, wallById, wallLength } from "./query.ts";
import { type RoomTemplate, type RoomTemplateInput, RoomTemplateSchema } from "./types.ts";

export class TemplateError extends Error {
  constructor(
    readonly templateId: string,
    readonly problems: readonly string[],
  ) {
    super(`floor template "${templateId}" is invalid:\n  - ${problems.join("\n  - ")}`);
    this.name = "TemplateError";
  }
}

/** Parse the raw shape only (zod). Throws a `ZodError` on failure. */
export function parseRoomTemplate(raw: unknown): RoomTemplate {
  return RoomTemplateSchema.parse(raw);
}

function duplicates(ids: string[]): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const id of ids) (seen.has(id) ? dupes : seen).add(id);
  return [...dupes];
}

/** Structural problems that do not need a nav grid. Empty when the template is sound. */
export function structuralProblems(t: RoomTemplate): string[] {
  const problems: string[] = [];
  const bounds: Rect = { x: 0, z: 0, w: t.size.width, d: t.size.depth };
  const wallHeightOf = (h: "full" | "stub") => (h === "full" ? t.wallHeight : t.stubHeight);

  for (const [what, ids] of [
    ["wall", t.walls.map((w) => w.id)],
    ["seat", t.seats.map((s) => s.id)],
    ["wallAnchor", t.wallAnchors.map((a) => a.id)],
    ["obstacle", t.obstacles.map((o) => o.id)],
    ["rug", t.rugs.map((r) => r.id)],
    ["wallDecor", t.wallDecor.map((d) => d.id)],
    ["decor", t.decor.map((d) => d.id)],
  ] as const) {
    for (const id of duplicates([...ids])) problems.push(`duplicate ${what} id "${id}"`);
  }

  for (const wall of t.walls) {
    const axisAligned = wall.from.x === wall.to.x || wall.from.z === wall.to.z;
    if (!axisAligned) problems.push(`wall "${wall.id}" is not axis-aligned`);
    if (wallLength(wall) <= 0) problems.push(`wall "${wall.id}" has zero length`);
    if (!rectContains(bounds, wall.from) || !rectContains(bounds, wall.to)) {
      problems.push(`wall "${wall.id}" leaves the room bounds`);
    }
    for (const opening of wall.openings) {
      if (opening.t + opening.w > wallLength(wall) + 1e-6) {
        problems.push(`${opening.kind} at t=${opening.t} runs past the end of wall "${wall.id}"`);
      }
    }
  }

  const nameWall = wallById(t, t.nameWallId);
  if (!nameWall) problems.push(`nameWallId "${t.nameWallId}" is not a wall`);
  else if (nameWall.height !== "stub")
    problems.push(`name wall "${t.nameWallId}" must be a stub wall`);

  const elevatorWall = wallById(t, t.elevator.wallId);
  if (!elevatorWall) problems.push(`elevator wallId "${t.elevator.wallId}" is not a wall`);
  else if (elevatorWall.height !== "full") problems.push("elevator must be set into a full wall");
  if (!rectInside(t.elevator.rect, bounds)) problems.push("elevator rect leaves the room bounds");
  if (!rectContains(bounds, t.spawn)) problems.push("spawn point is outside the room");

  // Anchors and wall decor share the checks; decor only differs in the label.
  const hung = [
    ...t.wallAnchors.map((a) => ({ ...a, label: "anchor" })),
    ...t.wallDecor.map((d) => ({ ...d, label: "wall decor" })),
  ];
  const spansByWall = new Map<string, { id: string; start: number; end: number }[]>();
  for (const item of hung) {
    const what = `${item.label} "${item.id}"`;
    const wall = wallById(t, item.wallId);
    if (!wall) {
      problems.push(`${what} references unknown wall "${item.wallId}"`);
      continue;
    }
    if (wall.height !== "full") {
      problems.push(`${what} must hang on a full wall (wall "${wall.id}" is a stub)`);
      continue;
    }
    const span = anchorSpan(item);
    const len = wallLength(wall);
    if (span.start < -1e-6 || span.end > len + 1e-6) {
      problems.push(`${what} hangs past the ends of wall "${wall.id}"`);
    }
    const top = item.y + item.h / 2;
    if (item.y - item.h / 2 < 0 || top > wallHeightOf(wall.height) + 1e-6) {
      problems.push(`${what} does not fit the height of wall "${wall.id}"`);
    }
    for (const opening of wall.openings) {
      if (spansOverlap(span.start, span.end, opening.t, opening.t + opening.w)) {
        problems.push(`${what} overlaps a ${opening.kind} on wall "${wall.id}"`);
      }
    }
    if (elevatorWall && wall.id === elevatorWall.id) {
      const ev = rectSpanOnWall(wall, t.elevator.rect);
      if (spansOverlap(span.start, span.end, ev.start, ev.end)) {
        problems.push(`${what} overlaps the elevator doors`);
      }
    }
    const list = spansByWall.get(wall.id) ?? [];
    for (const other of list) {
      if (spansOverlap(span.start, span.end, other.start, other.end)) {
        problems.push(`anchors "${other.id}" and "${item.id}" overlap on wall "${wall.id}"`);
      }
    }
    list.push({ id: item.id, ...span });
    spansByWall.set(wall.id, list);
  }

  const obstacleIds = new Set(t.obstacles.map((o) => o.id));
  for (const obstacle of t.obstacles) {
    if (!rectInside(obstacle.rect, bounds))
      problems.push(`obstacle "${obstacle.id}" leaves the room`);
    if (obstacle.standAt && !rectContains(bounds, obstacle.standAt)) {
      problems.push(`obstacle "${obstacle.id}" standAt is outside the room`);
    }
  }
  for (const [i, rug] of t.rugs.entries()) {
    if (!rectInside(rug.rect, bounds)) problems.push(`rug "${rug.id}" leaves the room`);
    // Same-style rugs lie at the same height, so an overlap would z-fight.
    for (const other of t.rugs.slice(0, i)) {
      if (other.style === rug.style && rectsOverlap(other.rect, rug.rect))
        problems.push(`rugs "${other.id}" and "${rug.id}" overlap`);
    }
  }
  for (const item of t.decor) {
    const base = t.obstacles.find((o) => o.id === item.on);
    if (!base) problems.push(`decor "${item.id}" stands on unknown obstacle "${item.on}"`);
    else if (!rectContains(base.rect, item))
      problems.push(`decor "${item.id}" is off its "${item.on}"`);
  }
  for (const seat of t.seats) {
    if (!rectContains(bounds, seat.pose)) problems.push(`seat "${seat.id}" is outside the room`);
    if (seat.furnitureId !== undefined && !obstacleIds.has(seat.furnitureId)) {
      problems.push(`seat "${seat.id}" references unknown furniture "${seat.furnitureId}"`);
    }
  }
  return problems;
}

/** Navigation problems: blocked seats / spawn / stand points, and anything unreachable from spawn. */
export function navigationProblems(t: RoomTemplate, grid: NavGrid = buildNavGrid(t)): string[] {
  const problems: string[] = [];
  const spawnCell = grid.worldToCell(t.spawn.x, t.spawn.z);
  if (!grid.isCellWalkable(spawnCell)) {
    problems.push("spawn point is on a blocked cell");
    return problems;
  }
  const reachable = grid.reachableFrom(spawnCell);
  const targets = [
    ...t.seats.map((s) => ({ label: `seat "${s.id}"`, x: s.pose.x, z: s.pose.z })),
    ...interactables(t).map((i) => ({
      label: `${i.kind} "${i.id}"`,
      x: i.standAt.x,
      z: i.standAt.z,
    })),
  ];
  for (const target of targets) {
    const cell = grid.worldToCell(target.x, target.z);
    if (!grid.isCellWalkable(cell)) problems.push(`${target.label} is on a blocked cell`);
    else if (!reachable.has(grid.index(cell)))
      problems.push(`${target.label} is unreachable from spawn`);
  }
  return problems;
}

/** All problems for an already-parsed template. */
export function templateProblems(t: RoomTemplate): string[] {
  const structural = structuralProblems(t);
  return structural.length > 0 ? structural : navigationProblems(t);
}

/** Parse and fully validate a raw template, throwing `TemplateError` / `ZodError` on failure. */
export function loadTemplate(raw: RoomTemplateInput): RoomTemplate {
  const template = parseRoomTemplate(raw);
  const problems = templateProblems(template);
  if (problems.length > 0) throw new TemplateError(template.id, problems);
  return template;
}
