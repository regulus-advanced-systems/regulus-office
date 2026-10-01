/**
 * Validation of BuildingRoom commands beyond the wire shape: `move` must stay
 * inside the world and `operation.go` must name an operation that exists. Pure
 * functions so they are unit-testable without a transport.
 */
import {
  type ClientCommand,
  COMPOUND_TILE_METRES,
  MAX_COMPOUND_SIZE_TILES,
  OUTSIDE_STRIP_TILES,
  parseClientCommand,
} from "@regulus/protocol";

/**
 * Half-extent of the walkable world in metres, applied on both axes. Since the
 * compound (#186) a position is anywhere in it, in compound metres from its
 * north-west corner, so the bound covers the largest compound plus its beach.
 */
export const WORLD_HALF_EXTENT =
  (MAX_COMPOUND_SIZE_TILES + OUTSIDE_STRIP_TILES) * COMPOUND_TILE_METRES;

export type CommandCheck = { ok: true; command: ClientCommand } | { ok: false; reason: string };

/** Parse `{ type, ...payload }` and apply the room's extra rules. */
export function checkCommand(type: string, payload: unknown): CommandCheck {
  const parsed = parseClientCommand(type, payload);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const where = first?.path.length ? `${first.path.join(".")}: ` : "";
    return { ok: false, reason: `invalid ${type}: ${where}${first?.message ?? "malformed"}` };
  }
  const command = parsed.data;
  if (command.type === "move" && !isInsideWorld(command.x, command.z)) {
    return { ok: false, reason: "invalid move: out of bounds" };
  }
  return { ok: true, command };
}

export function isInsideWorld(x: number, z: number): boolean {
  return Math.abs(x) <= WORLD_HALF_EXTENT && Math.abs(z) <= WORLD_HALF_EXTENT;
}

/** Normalise a heading into [-π, π) so the client never sees unbounded yaw. */
export function wrapHeading(heading: number): number {
  const twoPi = Math.PI * 2;
  let h = heading % twoPi;
  if (h >= Math.PI) h -= twoPi;
  if (h < -Math.PI) h += twoPi;
  return h;
}
