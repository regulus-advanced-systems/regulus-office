/**
 * Floor props around the walls (#182): what makes a room lived-in without
 * eating its lanes.
 *
 * - Corner sites (the three corners the full walls do not share; that one
 *   belongs to the board wall) hold at most a 0.9 m square, which leaves the
 *   1.5 m lanes along both walls connected round the corner.
 * - Wall sites hold props at most 0.45 m deep, only along walls whose band of
 *   free floor (wall to nearest desk pod) still leaves a 1.5 m lane beside
 *   them, never in front of an anchor or within 0.8 m of the door.
 *
 * The vanilla room gets a cabinet, a plant and a lamp, and the bookshelf of
 * the repo's docs (#264), which every room has. Every further desk
 * adds three props, in a fixed order, so props only ever appear as a room
 * grows and never move. Which kind fills a site depends on the decor style;
 * the footprint never does.
 */
import { type CompassDirection, HEADING, type Pose, type Rect } from "../geometry.ts";
import type { Obstacle } from "../types.ts";
import type { Run } from "./anchors.ts";
import type { Shell } from "./shell.ts";
import type { SlotGrid } from "./slots.ts";
import { type DecorStyleSpec, type SiteKind, styleModel } from "./styles.ts";

/** Distance from the wall line to a prop's back (clear of the wall's nav strip). */
const WALL_GAP = 0.12;
/** Free floor a wall prop must leave between itself and the desk pods. */
const LANE_BESIDE = 1.85;
/** Space between props along a wall, so they read as placed, not lined up. */
const SPACING = 1.4;
const DOOR_CLEAR = 0.8;
/** Wall props keep clear of the corners (corner props, the lamp and its plant). */
const CORNER = 1.6;
/** Lived-in props each desk beyond the first brings. */
const PROPS_PER_DESK = 3;

/** The room's bookshelf of the repo's docs (#264): the one floor prop people use. */
export const DOCS_SHELF_ID = "docs-shelf";
/** One look in every decor style (the kit's shelving), so people learn where the docs are. */
export const DOCS_SHELF_MODEL = "lair/common/bookshelf";
const SHELF_LEN = 1;
/** Front edge on a nav cell boundary (0.12 + 0.38 = 0.5), so the cell in front stays free. */
const SHELF_DEEP = 0.38;
/** Where a reader stands, from the wall line: the first cell centre in front of the shelf. */
const SHELF_STAND = 0.75;
/** Free floor the shelf must leave between itself and the desk pods: one lane. */
const SHELF_LANE = 1.5;

/**
 * How far the reader's stand point keeps from every wall anchor's: more than
 * a board's `E` reach (1.4 m in the scene; the gong's is 1.2 m) and the shelf's
 * own (1 m) together, so no spot answers `E` for both.
 */
export const SHELF_CLEARANCE = 2.5;

/** What the shelf keeps away from: anchor stand points, and wall decor spans along a side. */
export interface ShelfAvoid {
  readonly stands: ReadonlyArray<{ x: number; z: number }>;
  readonly decor: ReadonlyArray<{ side: string; start: number; end: number }>;
}

/** Smallest `t >= v` on a nav cell centre (0.25 mod 0.5), so a stand point ends a path exactly. */
function onCell(v: number): number {
  return Math.ceil((v - 0.25) / 0.5 - 1e-6) * 0.5 + 0.25;
}

export interface PlacedProp {
  obstacle: Obstacle;
  model: string;
}

interface Site {
  side: CompassDirection;
  /** On a back wall, beside the boards. */
  back: boolean;
  start: number;
  end: number;
  cursor: number;
  /** Free floor between this wall and the pods. */
  band: number;
}

/** Free floor between each wall and the nearest pod slot (filled or not). */
export function bands(grid: SlotGrid, width: number, depth: number) {
  const rects = grid.slots.map((s) => s.rect);
  if (rects.length === 0)
    return { north: depth / 2, south: depth / 2, west: width / 2, east: width / 2 };
  return {
    north: Math.min(...rects.map((r) => r.z)),
    south: depth - Math.max(...rects.map((r) => r.z + r.d)),
    west: Math.min(...rects.map((r) => r.x)),
    east: width - Math.max(...rects.map((r) => r.x + r.w)),
  };
}

function subtract(spans: Array<[number, number]>, a: number, b: number): Array<[number, number]> {
  return spans.flatMap(([s, e]): Array<[number, number]> => {
    if (b <= s || a >= e) return [[s, e]];
    return [
      [s, Math.min(e, a)],
      [Math.max(s, b), e],
    ].filter(([x, y]) => (y as number) - (x as number) > 0.3) as Array<[number, number]>;
  });
}

/** Wall sites: the stub walls, then what the board wall left free. */
function wallSites(
  shell: Shell,
  grid: SlotGrid,
  width: number,
  depth: number,
  free: Run[],
): Site[] {
  const band = bands(grid, width, depth);
  const sites: Site[] = [];
  const add = (side: CompassDirection, spans: Array<[number, number]>, back = false) => {
    let s = spans;
    if (shell.door.side === side)
      s = subtract(s, shell.door.start - DOOR_CLEAR, shell.door.end + DOOR_CLEAR);
    for (const [start, end] of s)
      sites.push({ side, back, start, end, cursor: start, band: band[side] });
  };
  for (const side of ["south", "east", "north", "west"] as const) {
    if (shell.full.includes(side)) continue;
    const len = side === "north" || side === "south" ? width : depth;
    add(side, [[CORNER, len - CORNER]]);
  }
  // Full walls are never split by the door, so a run's `t` is the side's.
  for (const run of free) {
    const side = run.wallId as CompassDirection;
    const len = side === "north" || side === "south" ? width : depth;
    add(side, [[Math.max(run.cursor, CORNER), Math.min(run.end, len - CORNER)]], true);
  }
  return sites.filter((site) => site.end - site.start > 0.3);
}

export type Corner = "nw" | "ne" | "sw" | "se";

function cornerAt(p: { x: number; z: number }): Corner {
  return `${p.z === 0 ? "n" : "s"}${p.x === 0 ? "w" : "e"}` as Corner;
}

/**
 * The corners that take props, by job: the far end of the back wall (the
 * vanilla plant), the far end of the side wall (the lamp) and the corner
 * diagonal from the board corner (lived-in extras). The corner the full
 * walls share belongs to the board wall.
 */
export function propCorners(shell: Shell): { plant: Corner; lamp: Corner; extra: Corner } {
  const [back, side] = shell.full.map((id) => shell.walls.find((w) => w.id === id));
  if (!back || !side) throw new Error("room shell has no full walls");
  const same = (a: { x: number; z: number }, b: { x: number; z: number }) =>
    a.x === b.x && a.z === b.z;
  const shared = [back.from, back.to].find((p) => same(p, side.from) || same(p, side.to));
  const farBack = same(back.from, shared ?? back.to) ? back.to : back.from;
  const farSide = same(side.from, shared ?? side.to) ? side.to : side.from;
  const all: Corner[] = ["nw", "ne", "sw", "se"];
  const taken = new Set([cornerAt(shared ?? back.from), cornerAt(farBack), cornerAt(farSide)]);
  return {
    plant: cornerAt(farBack),
    lamp: cornerAt(farSide),
    extra: all.find((c) => !taken.has(c)) ?? "se",
  };
}

/** Footprint of a prop `len` long and `deep` deep against `side` at `t` along it. */
function againstWall(
  side: CompassDirection,
  t: number,
  len: number,
  deep: number,
  width: number,
  depth: number,
): Rect {
  switch (side) {
    case "north":
      return { x: t, z: WALL_GAP, w: len, d: deep };
    case "south":
      return { x: t, z: depth - WALL_GAP - deep, w: len, d: deep };
    case "west":
      return { x: WALL_GAP, z: t, w: deep, d: len };
    case "east":
      return { x: width - WALL_GAP - deep, z: t, w: deep, d: len };
  }
}

export class PropPlanner {
  readonly props: PlacedProp[] = [];
  readonly #sites: Site[];
  #n = 0;

  constructor(
    readonly shell: Shell,
    readonly grid: SlotGrid,
    readonly width: number,
    readonly depth: number,
    free: Run[],
    readonly style: DecorStyleSpec,
  ) {
    this.#sites = wallSites(shell, grid, width, depth, free);
  }

  #push(kind: Obstacle["kind"], rect: Rect, role?: string): string {
    this.#n++;
    const id = `${kind.replaceAll("_", "-")}-${this.#n}`;
    this.props.push({ obstacle: { id, kind, rect }, model: styleModel(this.style, kind, role) });
    return id;
  }

  /**
   * The docs bookshelf (#264), against the first wall site with room for it
   * and a lane left in front, the board wall's free stretches first. It
   * keeps its own id and model in every style (it is used, not decor), and
   * its centre and stand point sit on nav cell centres. Null when no site
   * fits; generate.test.ts holds every size, door side and desk count to one.
   */
  docsShelf(avoid: ShelfAvoid = { stands: [], decor: [] }): string | null {
    const order = [...this.#sites].sort((a, b) => Number(b.back) - Number(a.back));
    const half = SHELF_LEN / 2;
    for (const site of order) {
      if (site.band - WALL_GAP - SHELF_DEEP < SHELF_LANE) continue;
      for (let from = site.cursor; ; from += 0.5) {
        const centre = onCell(from + half);
        if (centre + half > site.end + 1e-6) break;
        const standAt = this.#shelfStand(site.side, centre);
        const crowded = avoid.stands.some(
          (s) => Math.hypot(s.x - standAt.x, s.z - standAt.z) < SHELF_CLEARANCE - 1e-6,
        );
        // Taller than a cabinet: it does not stand under a clock, poster or pinboard.
        const underDecor = avoid.decor.some(
          (d) => d.side === site.side && d.end > centre - half && d.start < centre + half,
        );
        if (crowded || underDecor) continue;
        const rect = againstWall(
          site.side,
          centre - half,
          SHELF_LEN,
          SHELF_DEEP,
          this.width,
          this.depth,
        );
        site.cursor = centre + half + SPACING;
        this.props.push({
          obstacle: { id: DOCS_SHELF_ID, kind: "bookshelf", rect, standAt },
          model: DOCS_SHELF_MODEL,
        });
        return DOCS_SHELF_ID;
      }
    }
    return null;
  }

  /** In front of the shelf's centre, facing it. */
  #shelfStand(side: CompassDirection, centre: number): Pose {
    switch (side) {
      case "north":
        return { x: centre, z: SHELF_STAND, heading: HEADING.north };
      case "south":
        return { x: centre, z: this.depth - SHELF_STAND, heading: HEADING.south };
      case "west":
        return { x: SHELF_STAND, z: centre, heading: HEADING.west };
      case "east":
        return { x: this.width - SHELF_STAND, z: centre, heading: HEADING.east };
    }
  }

  readonly #corners = new Set<string>();

  /** A `size` square in a free corner, `inset` from both walls; null when the corner is taken. */
  corner(at: Corner, kind: Obstacle["kind"], size: number, role?: string): string | null {
    if (this.#corners.has(at)) return null;
    this.#corners.add(at);
    const inset = 0.15;
    const x = at.endsWith("w") ? inset : this.width - inset - size;
    const z = at.startsWith("n") ? inset : this.depth - inset - size;
    return this.#push(kind, { x, z, w: size, d: size }, role);
  }

  /** A floor lamp in a corner, with a small plant beside it along the north or south wall. */
  lampCorner(at: Corner, withPlant: boolean): string | null {
    if (this.#corners.has(at)) return null;
    this.#corners.add(at);
    const west = at.endsWith("w");
    const north = at.startsWith("n");
    const lamp = this.#push("floor_lamp", {
      x: west ? 0.2 : this.width - 0.55,
      z: north ? 0.2 : this.depth - 0.55,
      w: 0.35,
      d: 0.35,
    });
    if (withPlant)
      this.#push("plant_small", {
        x: west ? 0.65 : this.width - 1.05,
        z: north ? 0.15 : this.depth - 0.55,
        w: 0.4,
        d: 0.4,
      });
    return lamp;
  }

  #next = 0;

  /**
   * A prop against a wall site with room and a wide enough band; null when
   * none. Sites take turns, so props spread round the room; `back` tries
   * the board wall's free stretches first.
   */
  wall(
    kind: Obstacle["kind"],
    len: number,
    deep: number,
    role?: string,
    back = false,
  ): string | null {
    const n = this.#sites.length;
    const order = Array.from({ length: n }, (_, i) => this.#sites[(this.#next + i) % n] as Site);
    if (back) order.sort((a, b) => Number(b.back) - Number(a.back));
    for (const site of order) {
      if (site.band - WALL_GAP - deep < LANE_BESIDE) continue;
      if (site.cursor + len > site.end + 1e-6) continue;
      const rect = againstWall(site.side, site.cursor, len, deep, this.width, this.depth);
      site.cursor += len + SPACING;
      this.#next = (this.#sites.indexOf(site) + 1) % n;
      return this.#push(kind, rect, role);
    }
    return null;
  }

  /** Site kinds the style puts in the wall and corner roles. */
  siteKind(role: "corner" | "wallLong" | "wallShort"): SiteKind {
    return this.style[role];
  }
}

/**
 * Vanilla props, then three lived-in props per desk beyond the first. Returns
 * the ids of the floor lamps (they get lights).
 */
export function placeProps(p: PropPlanner, deskCount: number, avoid?: ShelfAvoid): string[] {
  // Vanilla: a cabinet by the boards, a plant and a lamp.
  const corners = propCorners(p.shell);
  if (!p.wall("cabinet", 1, 0.45, undefined, true)) p.corner(corners.extra, "cabinet", 0.8);
  p.corner(corners.plant, "plant", 0.8);
  const lamps = [p.lampCorner(corners.lamp, deskCount > 1)].filter(
    (id): id is string => id !== null,
  );
  p.docsShelf(avoid);

  let budget = PROPS_PER_DESK * (deskCount - 1) - (deskCount > 1 ? 1 : 0);
  if (budget > 0 && p.corner(corners.extra, p.siteKind("corner"), 0.8, "corner")) budget--;
  const cycle: Array<() => string | null> = [
    () => p.wall(p.siteKind("wallLong"), 1.2, 0.4, "wallLong"),
    () => {
      const id = p.wall("floor_lamp", 0.35, 0.35);
      if (id) lamps.push(id);
      return id;
    },
    () => p.wall(p.siteKind("wallShort"), 0.4, 0.4, "wallShort"),
    () => p.wall("plant", 0.6, 0.45),
  ];
  for (let i = 0, misses = 0; budget > 0 && misses < cycle.length; i++) {
    const make = cycle[i % cycle.length] as () => string | null;
    if (make()) {
      budget--;
      misses = 0;
    } else misses++;
  }
  return lamps;
}
