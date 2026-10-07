/**
 * The compound's architecture and furniture (#186): every visible room and
 * corridor chunk as lair kit pieces, drawn with ONE instanced mesh per piece
 * type for the whole compound (#183's draw budgets), their blob shadows in
 * one more draw, the consoles' blinking lamps, plaques and caps, and the
 * sliding doors. Rooms and chunks off screen are not in the lists at all.
 * A joined room's laptops and wall looks are its layers' (RoomLayers.tsx);
 * other rooms get static ones here.
 */
import { useMemo } from "react";
import { selectReducedMotion, useUiStore } from "../../state/ui.ts";
import { BlinkingLamps } from "../lair/components/BlinkingLamps.tsx";
import { BlobShadows } from "../lair/components/BlobShadows.tsx";
import { PieceSet } from "../lair/components/InstancedPieces.tsx";
import { RoomLooks } from "../lair/debug/RoomLooks.tsx";
import { Dust, Sparks } from "../lair/particles/BuildParticles.tsx";
import type { PiecePlacement } from "../lair/placements.ts";
import { MeetingDoorSigns } from "../meetings/MeetingDoorSigns.tsx";
import type { CorridorChunk } from "./corridors.ts";
import type { PlacedRoom } from "./placed.ts";
import { forQuality, presetOf, useQualityStore } from "./quality.ts";
import { LockedCaps, RoomSigns } from "./RoomMarkers.tsx";
import { useVisibleStore } from "./visibility.ts";
import type { CompoundWorld } from "./world.ts";

export interface CompoundStructureProps {
  world: CompoundWorld;
  rooms: readonly PlacedRoom[];
  chunks: readonly CorridorChunk[];
  visibleRooms: ReadonlySet<string>;
  visibleChunks: ReadonlySet<string>;
  /**
   * Rooms whose OperationRoom is joined, with their occupied desk seats: their
   * layers draw the henchmen's laptops and the wall looks; free desks keep kit laptops.
   */
  joined: ReadonlyMap<string, ReadonlySet<string>>;
}

export interface StructureLists {
  pieces: PiecePlacement[];
  shadows: PiecePlacement[];
  consoleLamps: PlacedRoom["consoleLamps"];
  looks: PlacedRoom["looks"];
}

/** The piece lists for what is on screen (pure; exported for the budget tests). */
export function structureLists(
  rooms: readonly PlacedRoom[],
  chunks: readonly CorridorChunk[],
  visibleRooms: ReadonlySet<string>,
  visibleChunks: ReadonlySet<string>,
  joined: ReadonlyMap<string, ReadonlySet<string>>,
): StructureLists {
  const pieces: PiecePlacement[] = [];
  const consoleLamps: PlacedRoom["consoleLamps"] = [];
  const looks: PlacedRoom["looks"] = [];
  for (const r of rooms) {
    if (!visibleRooms.has(r.room.id)) continue;
    pieces.push(...r.pieces);
    consoleLamps.push(...r.consoleLamps);
    const busy = joined.get(r.room.id);
    if (!busy) {
      pieces.push(...r.laptops);
      looks.push(...r.looks);
    } else {
      r.laptops.forEach((p, i) => {
        if (!busy.has(r.laptopSeats[i] ?? "")) pieces.push(p);
      });
    }
  }
  for (const c of chunks) if (visibleChunks.has(c.key)) pieces.push(...c.pieces);
  return { pieces, shadows: pieces, consoleLamps, looks };
}

export function CompoundStructure({
  world,
  rooms,
  chunks,
  visibleRooms,
  visibleChunks,
  joined,
}: CompoundStructureProps) {
  const preset = presetOf(useQualityStore((s) => s.quality));
  const far = useVisibleStore((s) => s.far);
  const lists = useMemo(() => {
    const all = structureLists(rooms, chunks, visibleRooms, visibleChunks, joined);
    const pieces = forQuality(all.pieces, far || preset.dropDecor);
    return { ...all, pieces, shadows: pieces };
  }, [rooms, chunks, visibleRooms, visibleChunks, joined, preset, far]);
  const locked = useMemo(
    () =>
      rooms
        .filter(
          (r) =>
            (r.art.look === "locked" || r.art.look === "closed") && visibleRooms.has(r.room.id),
        )
        .map((r) => r.room),
    [rooms, visibleRooms],
  );
  // Sparks and dust over at most one visible build site (two draws); none with reduced motion.
  const still = useUiStore(selectReducedMotion);
  const site = still
    ? undefined
    : rooms.find((r) => r.art.look === "building" && visibleRooms.has(r.room.id));
  return (
    <group name="compound-structure">
      <PieceSet items={lists.pieces} lite={preset.flatFloors} />
      {preset.blobShadows && <BlobShadows items={lists.shadows} />}
      <BlinkingLamps lamps={lists.consoleLamps} />
      <RoomLooks looks={lists.looks} />
      <LockedCaps rooms={locked} />
      <RoomSigns world={world} visible={visibleRooms} />
      <MeetingDoorSigns world={world} visible={visibleRooms} />
      {site && (
        <>
          <Sparks
            origin={[site.room.origin.x + site.room.size.w - 0.4, 2.4, site.room.origin.z + 2]}
          />
          <Dust
            box={{
              center: [
                site.room.origin.x + site.room.size.w / 2,
                1.2,
                site.room.origin.z + site.room.size.d / 2,
              ],
              size: [site.room.size.w, 2.4, site.room.size.d],
            }}
            count={60}
            size={0.45}
          />
        </>
      )}
    </group>
  );
}
