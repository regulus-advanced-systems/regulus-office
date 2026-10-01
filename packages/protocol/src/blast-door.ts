/**
 * The lobby's blast door (SPEC §9.1 Outside, §9.4; #188): shared state in the
 * BuildingRoom. A button on the lobby wall (and a keypad on the portal
 * outside) opens it for everyone; it stays open for the office's open time
 * (OFFICE_BLAST_DOOR_SECONDS, default 60 s), sounds a warning for the last
 * few seconds (`closing`) and then shuts. Pressing it while open holds it
 * open for another full period. Presses are rate-limited and audited on the
 * server.
 *
 * Phases: `closed` → `open` → `closing` (the warning) → `closed`. Clients
 * draw the leaves, beacons and klaxon from the phase; the nav grid through
 * the doorway is open in `open` and `closing`.
 *
 * Positions are compound metres (compound.ts): x east, z south, the blast
 * door in the lobby's south wall on the compound's south edge.
 */
import { z } from "zod";
import { Count, TimestampMs } from "./common.ts";
import type { CompoundState } from "./compound.ts";

export const BLAST_DOOR_PHASES = ["closed", "open", "closing"] as const;
export type BlastDoorPhase = (typeof BLAST_DOOR_PHASES)[number];

/** How long the door stays open by default (SPEC §9.1). */
export const DEFAULT_BLAST_DOOR_SECONDS = 60;
export const MIN_BLAST_DOOR_SECONDS = 4;
export const MAX_BLAST_DOOR_SECONDS = 600;
/** The warning (klaxon, beacons) before the door shuts; at most a quarter of the open time. */
export const BLAST_DOOR_WARNING_MS = 6000;

/** One human may press at most this often. */
export const BLAST_DOOR_PRESS_COOLDOWN_MS = 4000;
/** Nobody can press again this soon after any accepted press (the door is moving). */
export const BLAST_DOOR_GLOBAL_COOLDOWN_MS = 1500;

/** The command a button press sends to the BuildingRoom. */
export const BLAST_DOOR_PRESS = "blast_door.press";

/** The door as every client sees it. */
export const BlastDoorState = z.object({
  phase: z.enum(BLAST_DOOR_PHASES),
  /** Server ms of the last accepted press that opened or held it; 0 never. */
  openedAt: TimestampMs,
  /** Server ms at which it shuts; 0 while closed. */
  closesAt: TimestampMs,
  /** Who pressed last (display name). */
  openedBy: z.string().max(64),
  /** Accepted presses since the server started (a press counter for clients and tests). */
  presses: Count,
});
export type BlastDoorState = z.infer<typeof BlastDoorState>;

export const BLAST_DOOR_CLOSED: BlastDoorState = {
  phase: "closed",
  openedAt: 0,
  closesAt: 0,
  openedBy: "",
  presses: 0,
};

/** Is the doorway walkable in this phase? */
export function blastDoorPassable(phase: BlastDoorPhase): boolean {
  return phase !== "closed";
}

/** The warning length for an open time: {@link BLAST_DOOR_WARNING_MS}, at most a quarter of it. */
export function blastDoorWarningMs(openMs: number): number {
  return Math.min(BLAST_DOOR_WARNING_MS, Math.floor(openMs / 4));
}

type DoorFields = Pick<
  CompoundState,
  "tileMetres" | "blastDoorX" | "blastDoorY" | "blastDoorWidth" | "width"
>;

/** The doorway on the wall line, metres: from `x0` to `x1` at `z` (the compound's south edge). */
export function blastDoorSpan(c: DoorFields): { x0: number; x1: number; z: number } {
  const m = c.tileMetres;
  return { x0: c.blastDoorX * m, x1: (c.blastDoorX + c.blastDoorWidth) * m, z: c.blastDoorY * m };
}

/** How far from a button's stand point a human may press it (client reach). */
export const BLAST_DOOR_BUTTON_REACH = 1.6;
/** The server's reach: the client's plus slack for a pose in flight. */
export const BLAST_DOOR_SERVER_REACH = 4;
/** The inside button sits this far west of the doorway, the outside keypad as far east. */
export const BLAST_DOOR_BUTTON_OFFSET = 1.35;
/** Where someone pressing a button stands, metres from the wall line. */
export const BLAST_DOOR_STAND_OFF = 0.9;

export interface BlastDoorButton {
  side: "inside" | "outside";
  /** The panel on the wall line, metres. */
  wall: { x: number; z: number };
  /** Where the presser stands. */
  stand: { x: number; z: number };
}

/** The lobby wall button (west of the door, inside) and the portal keypad (east of it, outside). */
export function blastDoorButtons(c: DoorFields): [BlastDoorButton, BlastDoorButton] {
  const { x0, x1, z } = blastDoorSpan(c);
  const xi = x0 - BLAST_DOOR_BUTTON_OFFSET;
  const xo = x1 + BLAST_DOOR_BUTTON_OFFSET;
  return [
    { side: "inside", wall: { x: xi, z }, stand: { x: xi, z: z - BLAST_DOOR_STAND_OFF } },
    { side: "outside", wall: { x: xo, z }, stand: { x: xo, z: z + BLAST_DOOR_STAND_OFF } },
  ];
}

/** The button within `reach` metres of a point, if any. */
export function blastDoorButtonNear(
  c: DoorFields,
  x: number,
  z: number,
  reach = BLAST_DOOR_BUTTON_REACH,
): BlastDoorButton | null {
  if (c.blastDoorWidth === 0 || c.width === 0) return null;
  for (const b of blastDoorButtons(c)) {
    if (Math.hypot(b.stand.x - x, b.stand.z - z) <= reach) return b;
  }
  return null;
}
