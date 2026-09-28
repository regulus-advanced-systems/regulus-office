/**
 * Template validation: zod shape checks, then structural checks (references,
 * bounds, anchors on walls) and navigation checks (seats and interactables on
 * walkable cells, all reachable from the spawn point). `loadTemplate` runs all
 * three and throws, so a bad template fails at import time rather than in a room.
 */
import { type Rect, rectContains, rectInside, spansOverlap } from "./geometry.ts";
import { buildNavGrid, type NavGrid } from "./nav-grid.ts";
import { anchorSpan, interactables, rectSpanOnWall, wallById, wallLength } from "./query.ts";
import { type FloorTemplate, type FloorTemplateInput, FloorTemplateSchema } from "./types.ts";

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
export function parseFloorTemplate(raw: unknown): FloorTemplate {
  return FloorTemplateSchema.parse(raw);
}

function duplicates(ids: string[]): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const id of ids) (seen.has(id) ? dupes : seen).add(id);
  return [...dupes];
}

/** Structural problems that do not need a nav grid. Empty when the template is sound. */
export function structuralProblems(t: FloorTemplate): string[] {
  const problems: string[] = [];
  const bounds: Rect = { x: 0, z: 0, w: t.size.width, d: t.size.depth };
  const wallHeightOf = (h: "full" | "stub") => (h === "full" ? t.wallHeight : t.stubHeight);

  for (const [what, ids] of [
    ["wall", t.walls.map((w) => w.id)],
    ["seat", t.seats.map((s) => s.id)],
    ["wallAnchor", t.wallAnchors.map((a) => a.id)],
    ["obstacle", t.obstacles.map((o) => o.id)],
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

  const anchorsByWall = new Map<string, { id: string; start: number; end: number }[]>();
  for (const anchor of t.wallAnchors) {
    const wall = wallById(t, anchor.wallId);
    if (!wall) {
      problems.push(`anchor "${anchor.id}" references unknown wall "${anchor.wallId}"`);
      continue;
    }
    if (wall.height !== "full") {
      problems.push(`anchor "${anchor.id}" must hang on a full wall (wall "${wall.id}" is a stub)`);
      continue;
    }
    const span = anchorSpan(anchor);
    const len = wallLength(wall);
    if (span.start < -1e-6 || span.end > len + 1e-6) {
      problems.push(`anchor "${anchor.id}" hangs past the ends of wall "${wall.id}"`);
    }
    const top = anchor.y + anchor.h / 2;
    if (anchor.y - anchor.h / 2 < 0 || top > wallHeightOf(wall.height) + 1e-6) {
      problems.push(`anchor "${anchor.id}" does not fit the height of wall "${wall.id}"`);
    }
    for (const opening of wall.openings) {
      if (spansOverlap(span.start, span.end, opening.t, opening.t + opening.w)) {
        problems.push(`anchor "${anchor.id}" overlaps a ${opening.kind} on wall "${wall.id}"`);
      }
    }
    if (elevatorWall && wall.id === elevatorWall.id) {
      const ev = rectSpanOnWall(wall, t.elevator.rect);
      if (spansOverlap(span.start, span.end, ev.start, ev.end)) {
        problems.push(`anchor "${anchor.id}" overlaps the elevator doors`);
      }
    }
    const list = anchorsByWall.get(wall.id) ?? [];
    for (const other of list) {
      if (spansOverlap(span.start, span.end, other.start, other.end)) {
        problems.push(`anchors "${other.id}" and "${anchor.id}" overlap on wall "${wall.id}"`);
      }
    }
    list.push({ id: anchor.id, ...span });
    anchorsByWall.set(wall.id, list);
  }

  const obstacleIds = new Set(t.obstacles.map((o) => o.id));
  for (const obstacle of t.obstacles) {
    if (!rectInside(obstacle.rect, bounds))
      problems.push(`obstacle "${obstacle.id}" leaves the room`);
    if (obstacle.standAt && !rectContains(bounds, obstacle.standAt)) {
      problems.push(`obstacle "${obstacle.id}" standAt is outside the room`);
    }
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
export function navigationProblems(t: FloorTemplate, grid: NavGrid = buildNavGrid(t)): string[] {
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
export function templateProblems(t: FloorTemplate): string[] {
  const structural = structuralProblems(t);
  return structural.length > 0 ? structural : navigationProblems(t);
}

/** Parse and fully validate a raw template, throwing `TemplateError` / `ZodError` on failure. */
export function loadTemplate(raw: FloorTemplateInput): FloorTemplate {
  const template = parseFloorTemplate(raw);
  const problems = templateProblems(template);
  if (problems.length > 0) throw new TemplateError(template.id, problems);
  return template;
}
