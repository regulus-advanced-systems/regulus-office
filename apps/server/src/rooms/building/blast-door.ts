/**
 * The lobby's blast door in the BuildingRoom (SPEC §9.1 Outside, #188):
 * shared state every client draws (protocol `blast-door.ts`). A press from
 * the lobby button or the outside keypad opens it, or holds it open for
 * another full period; the room's sweep calls `tick`, which moves it to the
 * `closing` warning and then shuts it. Presses must come from someone
 * standing at a button (their last published pose), are rate-limited per
 * human and globally, and every accepted press is audited.
 */
import {
  BLAST_DOOR_GLOBAL_COOLDOWN_MS,
  BLAST_DOOR_PRESS_COOLDOWN_MS,
  BLAST_DOOR_SERVER_REACH,
  type BlastDoorStateSchema,
  blastDoorButtonNear,
  blastDoorWarningMs,
  type CompoundState,
  DEFAULT_BLAST_DOOR_SECONDS,
} from "@regulus/protocol";

type DoorTarget = InstanceType<typeof BlastDoorStateSchema>;

export interface BlastDoorPress {
  userId: string;
  displayName: string;
  /** Which button, and whether it opened the door or held it open. */
  side: "inside" | "outside";
  held: boolean;
}

export interface BlastDoorOptions {
  /** How long a press keeps it open, ms (OFFICE_BLAST_DOOR_SECONDS). */
  openMs?: number;
  /** Record an accepted press (the audit log). */
  audit?: (press: BlastDoorPress) => void;
}

export type PressResult = { ok: true; press: BlastDoorPress } | { ok: false; reason: string };

export interface BlastDoor {
  readonly openMs: number;
  press(
    door: DoorTarget,
    who: { userId: string; displayName: string },
    at: { x: number; z: number },
    compound: CompoundState | undefined,
  ): PressResult;
  /** Advance the phases; cheap, called from the room's sweep. */
  tick(door: DoorTarget): void;
}

export function createBlastDoor(options: BlastDoorOptions, now: () => number): BlastDoor {
  const openMs = options.openMs ?? DEFAULT_BLAST_DOOR_SECONDS * 1000;
  const warnMs = blastDoorWarningMs(openMs);
  const lastByUser = new Map<string, number>();
  let lastAccepted = Number.NEGATIVE_INFINITY;

  return {
    openMs,
    press(door, who, at, compound) {
      if (!compound || compound.width === 0 || compound.blastDoorWidth === 0)
        return { ok: false, reason: "The blast door is not ready yet." };
      const button = blastDoorButtonNear(compound, at.x, at.z, BLAST_DOOR_SERVER_REACH);
      if (!button) return { ok: false, reason: "Walk up to the blast door button to press it." };
      const t = now();
      if (t - lastAccepted < BLAST_DOOR_GLOBAL_COOLDOWN_MS)
        return { ok: false, reason: "The blast door is already moving." };
      const mine = lastByUser.get(who.userId);
      if (mine !== undefined && t - mine < BLAST_DOOR_PRESS_COOLDOWN_MS)
        return { ok: false, reason: "Easy on the button: wait a moment before pressing again." };
      lastAccepted = t;
      // Old entries can never block again; keep the map small.
      for (const [id, when] of lastByUser)
        if (t - when >= BLAST_DOOR_PRESS_COOLDOWN_MS) lastByUser.delete(id);
      lastByUser.set(who.userId, t);
      const held = door.phase !== "closed";
      door.phase = "open";
      door.openedAt = t;
      door.closesAt = t + openMs;
      door.openedBy = who.displayName.slice(0, 64);
      door.presses += 1;
      const press: BlastDoorPress = { ...who, side: button.side, held };
      options.audit?.(press);
      return { ok: true, press };
    },
    tick(door) {
      if (door.phase === "closed") return;
      const t = now();
      if (t >= door.closesAt) {
        door.phase = "closed";
        door.closesAt = 0;
      } else if (door.phase === "open" && t >= door.closesAt - warnMs) {
        door.phase = "closing";
      }
    },
  };
}
