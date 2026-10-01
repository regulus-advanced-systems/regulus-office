/**
 * Room transitions (#187): what changed between two renders of the
 * compound and how it animates.
 * - raise: a new room's build site goes up;
 * - reveal: building → ready, the scaffolding comes down and the interior
 *   rises in its place;
 * - grow: desks or decor changed (room settings, or its live preview), the
 *   pieces that went sink and the new ones rise;
 * - move: the room folds down at its old spot and rises at the new one;
 * - demolish: the room is gone (deleted or archived), its walls crumble.
 * Pieces are compared by kind and pose, so only what really changed moves.
 * A change of access (a door that unlocks) is not a transition. Pure.
 */
import type { PiecePlacement } from "../../lair/placements.ts";
import type { PlacedRoom } from "../placed.ts";
import type { WorldRoom } from "../world.ts";

export type TransitionKind = "raise" | "reveal" | "grow" | "move" | "demolish";

/** Seconds each kind plays. */
export const TRANSITION_SECONDS: Readonly<Record<TransitionKind, number>> = {
  raise: 1.1,
  reveal: 1.7,
  grow: 0.9,
  move: 1.3,
  demolish: 1.5,
};

export interface Footprint {
  x: number;
  z: number;
  w: number;
  d: number;
}

export interface RoomTransition {
  key: string;
  roomId: string;
  kind: TransitionKind;
  /** World placements that rise in; held out of the compound's own set until done. */
  arrivals: PiecePlacement[];
  /** Keys of `arrivals` (see `pieceKey`). */
  held: ReadonlySet<string>;
  /** World placements that sink away. */
  departures: PiecePlacement[];
  /** Where dust rises (metres). */
  footprint: Footprint;
  seconds: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function pieceKey(p: PiecePlacement): string {
  return `${p.piece}@${r2(p.position[0])},${r2(p.position[1])},${r2(p.position[2])},${r2(p.rotationY ?? 0)}|${p.tint ?? ""}`;
}

/** Everything a placed room draws as kit pieces. */
function allPieces(p: PlacedRoom): PiecePlacement[] {
  return [...p.pieces, ...p.laptops];
}

function footprintOf(room: WorldRoom): Footprint {
  return { x: room.origin.x, z: room.origin.z, w: room.size.w, d: room.size.d };
}

/** What kind of change from `prev` to `next` animates, if any. */
export function classify(
  prev: WorldRoom | undefined,
  next: WorldRoom | undefined,
): TransitionKind | null {
  if (!prev && next) return "raise";
  if (prev && !next) return prev.kind === "project" ? "demolish" : null;
  if (!prev || !next || next.kind !== "project") return null;
  const r = prev.rect;
  const n = next.rect;
  if (r.x !== n.x || r.y !== n.y || r.w !== n.w || r.d !== n.d || prev.doorSide !== next.doorSide)
    return "move";
  if (prev.buildState === "building" && next.buildState === "ready") return "reveal";
  if (prev.buildState !== "ready" || next.buildState !== "ready") return null;
  if (prev.deskCount !== next.deskCount || prev.decorStyle !== next.decorStyle) return "grow";
  return null;
}

function diffPieces(prev: PiecePlacement[], next: PiecePlacement[]) {
  const before = new Map(prev.map((p) => [pieceKey(p), p]));
  const after = new Map(next.map((p) => [pieceKey(p), p]));
  const arrivals = [...after].filter(([k]) => !before.has(k)).map(([, p]) => p);
  const departures = [...before].filter(([k]) => !after.has(k)).map(([, p]) => p);
  return { arrivals, departures };
}

/** The transitions between two renders' rooms (none on the first render). */
export function diffRooms(
  prev: readonly PlacedRoom[],
  next: readonly PlacedRoom[],
  seq = 0,
): RoomTransition[] {
  const before = new Map(prev.map((p) => [p.room.id, p]));
  const after = new Map(next.map((p) => [p.room.id, p]));
  const out: RoomTransition[] = [];
  for (const id of new Set([...before.keys(), ...after.keys()])) {
    const a = before.get(id);
    const b = after.get(id);
    const kind = classify(a?.room, b?.room);
    if (!kind) continue;
    let arrivals: PiecePlacement[] = [];
    let departures: PiecePlacement[] = [];
    if (kind === "reveal" || kind === "grow") {
      ({ arrivals, departures } = diffPieces(a ? allPieces(a) : [], b ? allPieces(b) : []));
      if (arrivals.length === 0 && departures.length === 0) continue;
    } else {
      arrivals = b ? allPieces(b) : [];
      departures = a ? allPieces(a) : [];
    }
    const room = (b ?? a)?.room;
    if (!room) continue;
    out.push({
      key: `${id}#${kind}#${seq}`,
      roomId: id,
      kind,
      arrivals,
      held: new Set(arrivals.map(pieceKey)),
      departures,
      footprint: footprintOf(kind === "demolish" || kind === "move" ? (a?.room ?? room) : room),
      seconds: TRANSITION_SECONDS[kind],
    });
  }
  return out;
}

/** The rooms with the pieces still rising held out (they are drawn by the transition). */
export function holdArrivals(
  rooms: readonly PlacedRoom[],
  transitions: readonly RoomTransition[],
): readonly PlacedRoom[] {
  if (transitions.length === 0) return rooms;
  const held = new Map<string, Set<string>>();
  for (const t of transitions) {
    if (t.held.size === 0) continue;
    const set = held.get(t.roomId) ?? new Set<string>();
    for (const k of t.held) set.add(k);
    held.set(t.roomId, set);
  }
  if (held.size === 0) return rooms;
  return rooms.map((r) => {
    const keys = held.get(r.room.id);
    if (!keys) return r;
    const laptops: PiecePlacement[] = [];
    const laptopSeats: string[] = [];
    r.laptops.forEach((p, i) => {
      if (keys.has(pieceKey(p))) return;
      laptops.push(p);
      laptopSeats.push(r.laptopSeats[i] ?? "");
    });
    return { ...r, pieces: r.pieces.filter((p) => !keys.has(pieceKey(p))), laptops, laptopSeats };
  });
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Overshooting ease-out (a piece settles into place). */
export function easeOutBack(t: number): number {
  const c = 1.4;
  const u = clamp01(t) - 1;
  return 1 + (c + 1) * u * u * u + c * u * u;
}

/**
 * Heights (scale y) of the sinking and rising groups at `t` seconds into a
 * transition: what goes, goes first; what comes rises as it clears.
 */
export function transitionScales(
  kind: TransitionKind,
  t: number,
  seconds: number,
): { departing: number; arriving: number } {
  const f = clamp01(t / seconds);
  const out = {
    raise: { end: 0, start: 0 },
    reveal: { end: 0.55, start: 0.35 },
    grow: { end: 0.6, start: 0.25 },
    move: { end: 0.5, start: 0.45 },
    demolish: { end: 1, start: 1 },
  }[kind];
  const departing = out.end <= 0 ? 0 : 1 - clamp01(f / out.end) ** 2;
  const arriving = out.start >= 1 ? 0 : easeOutBack((f - out.start) / (1 - out.start));
  return { departing: Math.max(0, departing), arriving: Math.max(0, arriving) };
}
