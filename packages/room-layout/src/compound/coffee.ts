/**
 * The break room's coffee machine (SPEC §9.1 special rooms; #63): where it
 * stands on the counter wall and where someone taking a cup stands. Shared
 * by the client, which draws the machine and its click target, and the
 * server, which checks that whoever asks for a cup is standing at it.
 */

/** The machine's footprint and the stand point in front of it, metres. */
export interface CoffeeMachineSpot {
  rect: { x: number; z: number; w: number; d: number };
  /** Where the drinker stands: west of the machine, facing it. */
  stand: { x: number; z: number };
}

/** How far in front of the machine the drinker stands, metres from its face. */
export const COFFEE_STAND_OFF = 0.7;

/**
 * The coffee machine of a break room of `w × d` metres, in the room's own
 * frame (metres from its north-west corner): on the east wall, between the
 * counter and the fridge.
 */
export function breakRoomCoffeeMachine(w: number, _d: number): CoffeeMachineSpot {
  const rect = { x: w - 1.1, z: 7.3, w: 0.7, d: 0.7 };
  return { rect, stand: { x: rect.x - COFFEE_STAND_OFF, z: rect.z + rect.d / 2 } };
}

/** The slice of a published compound the machine is found in. */
export interface CoffeeCompound {
  tileMetres: number;
  specialRooms: Iterable<{
    kind: string;
    gridX: number;
    gridY: number;
    width: number;
    depth: number;
  }>;
}

/**
 * The coffee machine in compound metres, or null on a level without a break
 * room (every level but the lobby level) or before the compound is published.
 */
export function coffeeMachineSpot(compound: CoffeeCompound): CoffeeMachineSpot | null {
  const m = compound.tileMetres;
  for (const s of compound.specialRooms) {
    if (s.kind !== "break_room" || s.width <= 0) continue;
    const local = breakRoomCoffeeMachine(s.width * m, s.depth * m);
    const x = s.gridX * m;
    const z = s.gridY * m;
    return {
      rect: { ...local.rect, x: local.rect.x + x, z: local.rect.z + z },
      stand: { x: local.stand.x + x, z: local.stand.z + z },
    };
  }
  return null;
}
