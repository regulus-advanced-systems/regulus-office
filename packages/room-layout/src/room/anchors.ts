/**
 * The board wall (#182, SPEC §9.4): wall anchors for the issue and PR
 * boards, the task queue clipboard, the whiteboard, the usage screen, the
 * merge gong and pictures, then non-interactive wall decor in what is left.
 *
 * Anchors hang on the two full walls (the one facing the door, "back", and
 * its neighbour, "side"; north and west for a door on the south), starting
 * 0.3 m from the corner they share and stopping 1 m short of the other
 * corners (those hold corner props). The boards and the clipboard hang side
 * by side, preferably on the side wall; the whiteboard, usage screen and
 * gong prefer the back wall. The gong keeps its stand point more than
 * `GONG_CLEARANCE` from every board-like stand point, so `E` never rings it
 * by accident.
 */
import { anchorStandPose, wallLength } from "../query.ts";
import type { Wall, WallAnchor, WallAnchorKind, WallDecor } from "../types.ts";
import type { Shell } from "./shell.ts";

/** Board and gong `E` reach (1.4 m and 1.2 m in the scene) plus a margin. */
export const GONG_CLEARANCE = 2.7;
/** Gap between neighbouring anchors on a wall, metres. */
const GAP = 0.3;
const MIN_GAP = 0.1;
/** Clear distance kept from the corner the full walls share, and from the others. */
const NW_MARGIN = 0.3;
const CORNER_MARGIN = 1;

export const BOARD_LIKE: ReadonlySet<WallAnchorKind> = new Set([
  "issue_board",
  "pr_board",
  "queue_clipboard",
  "whiteboard",
]);

interface Spec {
  kind: WallAnchorKind;
  w: number;
  /** Narrowest the anchor may shrink to in a tight room. */
  minW: number;
  h: number;
  y: number;
}

const SPECS: Readonly<Record<WallAnchorKind, Spec>> = {
  issue_board: { kind: "issue_board", w: 1.8, minW: 1.4, h: 1.2, y: 1.5 },
  pr_board: { kind: "pr_board", w: 1.8, minW: 1.4, h: 1.2, y: 1.5 },
  queue_clipboard: { kind: "queue_clipboard", w: 0.5, minW: 0.5, h: 0.7, y: 1.5 },
  whiteboard: { kind: "whiteboard", w: 2.2, minW: 1.5, h: 1.2, y: 1.4 },
  usage_wall: { kind: "usage_wall", w: 1.4, minW: 1, h: 0.9, y: 1.7 },
  gong: { kind: "gong", w: 0.56, minW: 0.56, h: 1.5, y: 1.25 },
  picture: { kind: "picture", w: 0.9, minW: 0.9, h: 0.6, y: 1.6 },
  tv: { kind: "tv", w: 1.4, minW: 1.4, h: 0.8, y: 1.6 },
};

const DECOR_SIZE = {
  clock: { w: 0.5, h: 0.5, y: 2.3 },
  corkboard: { w: 0.8, h: 0.6, y: 1.7 },
  poster: { w: 0.6, h: 0.9, y: 1.6 },
  shelf: { w: 1.2, h: 0.3, y: 1.9 },
} as const;
/** Wall space each decor item takes, whatever its kind (the widest is the shelf). */
const DECOR_SLOT = 1.2;

/** Which full wall a run is on: the one facing the door, or its neighbour. */
type Role = "back" | "side";

/** A free stretch of a full wall, in that wall's own `t` (metres from its `from`). */
export interface Run {
  wallId: string;
  role: Role;
  start: number;
  end: number;
  /** Next free `t` on this run. */
  cursor: number;
  /** End of the last anchor on this run (wall decor may hang past it, over floor props). */
  anchorEnd: number;
}

/**
 * Free stretches of the two full walls, the side wall first: from 0.3 m off
 * the corner they share to 1 m short of their other corners (corner props).
 * The door is never in a full wall.
 */
export function backWallRuns(shell: Shell): Run[] {
  const [backId, sideId] = shell.full;
  const back = shell.walls.find((w) => w.id === backId);
  const side = shell.walls.find((w) => w.id === sideId);
  if (!back || !side) throw new Error("room shell has no full walls");
  const shared = [back.from, back.to].find((p) =>
    [side.from, side.to].some((q) => q.x === p.x && q.z === p.z),
  );
  return [side, back].map((wall) => {
    const len = wallLength(wall);
    const atStart = shared !== undefined && wall.from.x === shared.x && wall.from.z === shared.z;
    const start = atStart ? NW_MARGIN : CORNER_MARGIN;
    const end = len - (atStart ? CORNER_MARGIN : NW_MARGIN);
    const role: Role = wall === back ? "back" : "side";
    return { wallId: wall.id, role, start, end, cursor: start, anchorEnd: start };
  });
}

function free(run: Run): number {
  return run.end - run.cursor;
}

interface Placer {
  walls: Wall[];
  runs: Run[];
  anchors: WallAnchor[];
}

function anchor(id: string, spec: Spec, wallId: string, t: number, w: number): WallAnchor {
  return { id, kind: spec.kind, wallId, t, y: spec.y, w, h: spec.h, approach: 0.75 };
}

/** Smallest `t >= v` on a nav cell centre (0.25 mod 0.5), so stand points end paths exactly. */
function onCell(v: number): number {
  return Math.ceil((v - 0.25) / 0.5 - 1e-6) * 0.5 + 0.25;
}

/** Lay `specs` side by side from `start`; null when they run past `end`. */
function layOut(
  run: Run,
  ids: string[],
  specs: Spec[],
  widths: number[],
  start: number,
): { placed: WallAnchor[]; end: number } | null {
  let t = start;
  const placed: WallAnchor[] = [];
  for (const [i, spec] of specs.entries()) {
    const w = widths[i] as number;
    // The cell-centre snap may eat into the gap, but leaves at least `MIN_GAP`.
    const centre = onCell(t + w / 2 - (i === 0 ? 0 : GAP - MIN_GAP));
    if (centre + w / 2 > run.end + 1e-6) return null;
    placed.push(anchor(ids[i] as string, spec, run.wallId, centre, w));
    t = centre + w / 2 + GAP;
  }
  return { placed, end: t };
}

/** Put one item (or a contiguous group) on the first preferred run with room for it. */
function placeGroup(
  p: Placer,
  ids: string[],
  specs: Spec[],
  prefer: readonly Role[],
  ok: (a: WallAnchor[]) => boolean = () => true,
): boolean {
  const runs = prefer.flatMap((role) => p.runs.filter((r) => r.role === role));
  for (const shrink of [false, true]) {
    const widths = specs.map((s) => (shrink ? s.minW : s.w));
    for (const run of runs) {
      // Scan forward along the run until the group fits and `ok` holds.
      for (let start = run.cursor; start < run.end; start += 0.5) {
        const laid = layOut(run, ids, specs, widths, start);
        if (!laid) break;
        if (!ok(laid.placed)) continue;
        p.anchors.push(...laid.placed);
        run.cursor = laid.end;
        run.anchorEnd = laid.end;
        return true;
      }
    }
  }
  return false;
}

function standOf(walls: Wall[], a: WallAnchor) {
  const wall = walls.find((w) => w.id === a.wallId);
  return wall ? anchorStandPose(wall, a) : { x: Number.NaN, z: Number.NaN, heading: 0 };
}

export interface BoardWall {
  anchors: WallAnchor[];
  wallDecor: WallDecor[];
  /** Back-wall stretches left free of anchors (wall decor may hang above them). */
  free: Run[];
}

/**
 * Hang every anchor kind a project room uses, plus `pictures` extra pictures
 * and up to `decor` wall decor items, as far as the walls allow. Throws when
 * a required anchor does not fit (never for 4×4 to 12×12 rooms; tested).
 */
export function hangBoardWall(
  shell: Shell,
  width: number,
  depth: number,
  extraPictures: number,
  decor: readonly (keyof typeof DECOR_SIZE)[],
): BoardWall {
  const p = firstPlan(shell, width, depth);
  const wallDecor: WallDecor[] = [];
  // Alternate wall decor and extra pictures, so the walls do not read as a row of frames.
  for (let i = 0; i < Math.max(decor.length, extraPictures); i++) {
    const kind = decor[i];
    if (kind) {
      // Every decor item takes the same slot, so a style's choice never moves the anchors.
      const size = DECOR_SIZE[kind];
      const run = p.runs.find((r) => free(r) >= DECOR_SLOT);
      if (run) {
        wallDecor.push({
          id: `wall-${kind}-${i + 1}`,
          kind,
          wallId: run.wallId,
          t: run.cursor + DECOR_SLOT / 2,
          ...size,
        });
        run.cursor += DECOR_SLOT + GAP;
      }
    }
    if (i < extraPictures) placeGroup(p, [`picture-${i + 2}`], [SPECS.picture], ["back", "side"]);
  }
  const freeRuns = p.runs.map((r) => ({ ...r, cursor: r.anchorEnd }));
  return { anchors: p.anchors, wallDecor, free: freeRuns };
}

type Side = Role;
const SINGLES = [
  { ids: ["whiteboard"], specs: [SPECS.whiteboard] },
  { ids: ["usage-wall"], specs: [SPECS.usage_wall] },
  { ids: ["gong"], specs: [SPECS.gong] },
  { ids: ["picture-1"], specs: [SPECS.picture] },
];

function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [items.slice()];
  return items.flatMap((item, i) =>
    permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [item, ...rest]),
  );
}

/**
 * The first arrangement that hangs every required anchor: boards on the
 * west wall (else north) and the rest on the north wall (else west), in the
 * preferred order first; tight rooms fall back to other orders and sides.
 */
function firstPlan(shell: Shell, width: number, depth: number): Placer {
  const orders = permutations(SINGLES);
  const sides: Array<[Side[], Side[]]> = [
    [
      ["side", "back"],
      ["back", "side"],
    ],
    [
      ["back", "side"],
      ["side", "back"],
    ],
    [
      ["side", "back"],
      ["side", "back"],
    ],
  ];
  for (const [boardSides, otherSides] of sides) {
    for (const order of orders) {
      const p: Placer = {
        walls: shell.walls,
        runs: backWallRuns(shell),
        anchors: [],
      };
      const gongSafe = (placed: WallAnchor[]) => gongClear(p, placed);
      const boards = placeGroup(
        p,
        ["issue-board", "pr-board", "queue-clipboard"],
        [SPECS.issue_board, SPECS.pr_board, SPECS.queue_clipboard],
        boardSides,
        gongSafe,
      );
      if (boards && order.every((g) => placeGroup(p, g.ids, g.specs, otherSides, gongSafe)))
        return p;
    }
  }
  throw new Error(`room ${width}x${depth} (${shell.door.side}): the board wall does not fit`);
}

/** No board-like stand point within `GONG_CLEARANCE` of the gong's. */
function gongClear(p: Placer, placed: WallAnchor[]): boolean {
  const all = [...p.anchors, ...placed];
  const gongs = all.filter((a) => a.kind === "gong").map((a) => standOf(p.walls, a));
  const boards = all.filter((a) => BOARD_LIKE.has(a.kind)).map((a) => standOf(p.walls, a));
  return gongs.every((g) => boards.every((b) => Math.hypot(b.x - g.x, b.z - g.z) > GONG_CLEARANCE));
}
