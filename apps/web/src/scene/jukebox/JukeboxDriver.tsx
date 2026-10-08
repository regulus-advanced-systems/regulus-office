/**
 * The lobby jukebox in the scene (#47, SPEC §9.2, §9.4): how loud it is
 * where the player stands, and using it.
 *
 * Loudness: the walking distance from the jukebox through the compound
 * (audio/soundField.ts over the nav grid, rebuilt when the grid changes)
 * through the shared falloff curve (audio/spatial.ts), times the room
 * occlusion (full in the lobby, half in the corridors, a fifth in another
 * room). Written to `useJukeboxStore.level` five times a second; the
 * playback hook and the YouTube panel apply it. The jukebox is in the lobby,
 * on the lobby level: on any other level it is silent.
 *
 * Using it: a click on the jukebox walks over and opens the jukebox panel
 * on arrival; `E` opens it from the spot in front. A lamp on top glows
 * while music plays (and pulses gently, unless motion is reduced).
 */
import { type ThreeEvent, useFrame } from "@react-three/fiber";
import type { NavGrid } from "@regulus/room-layout";
import { useCallback, useEffect, useMemo, useRef } from "react";
import type { Mesh } from "three";
import { buildSoundField } from "../../audio/soundField.ts";
import { attenuation, JUKEBOX_FALLOFF, roomOcclusion } from "../../audio/spatial.ts";
import { useBuildingStore } from "../../state/building.ts";
import { useJukeboxStore } from "../../state/jukebox.ts";
import { usePlayerStore } from "../../state/player.ts";
import { selectReducedMotion, useUiStore } from "../../state/ui.ts";
import type { HotkeyEventDetail } from "../../ui/hotkeys/registry.ts";
import { useHotkeyEvents } from "../../ui/hotkeys/useHotkeys.ts";
import { type CompoundWorld, roomAt } from "../compound/world.ts";
import { JUKEBOX_REACH, jukeboxSpot } from "./spot.ts";

const LEVEL_EVERY_S = 0.2;
/** On top of the arch (the lair kit's jukebox, scaled to 1.5 m tall). */
const LAMP_HEIGHT = 1.53;

export function JukeboxDriver({ world, grid }: { world: CompoundWorld; grid: NavGrid }) {
  const spot = useMemo(() => jukeboxSpot(world), [world]);
  const field = useMemo(
    () => (spot ? buildSoundField(grid, spot, JUKEBOX_FALLOFF.maxDistance) : null),
    [grid, spot],
  );
  const playing = useBuildingStore((s) => Boolean(s.state?.jukebox.playing));
  const reduced = useUiStore(selectReducedMotion);
  const since = useRef(LEVEL_EVERY_S);
  const pending = useRef(false);
  const lamp = useRef<Mesh>(null);
  useEffect(() => {
    useJukeboxStore.getState().setStand(spot ? spot.stand : null);
    // A level without the jukebox (every level but the lobby level, #269) does not hear it.
    if (!spot) useJukeboxStore.getState().setLevel(0, Number.POSITIVE_INFINITY);
    return () => useJukeboxStore.getState().setStand(null);
  }, [spot]);

  useFrame((state, delta) => {
    if (lamp.current) {
      const pulse = playing && !reduced ? 1 + 0.12 * Math.sin(state.clock.elapsedTime * 4.2) : 1;
      lamp.current.scale.setScalar(pulse);
    }
    since.current += delta;
    if (!spot || !field || since.current < LEVEL_EVERY_S) return;
    since.current = 0;
    const p = usePlayerStore.getState();
    if (!p.spawned) return;
    if (pending.current) {
      const there = Math.hypot(p.x - spot.stand.x, p.z - spot.stand.z) <= JUKEBOX_REACH;
      if (there && !p.path) {
        pending.current = false;
        useJukeboxStore.getState().openPanel();
      } else if (!p.target) pending.current = false;
    }
    const distance = field.distanceAt(p.x, p.z);
    const room = roomAt(world, p.x, p.z)?.id ?? null;
    const level = attenuation(distance, JUKEBOX_FALLOFF) * roomOcclusion(spot.roomId, room);
    useJukeboxStore.getState().setLevel(level, distance);
  });

  useHotkeyEvents(
    useCallback(
      (detail: HotkeyEventDetail) => {
        if (detail.id !== "interact" || detail.handled || !spot) return;
        const p = usePlayerStore.getState();
        if (!p.spawned || Math.hypot(p.x - spot.stand.x, p.z - spot.stand.z) > JUKEBOX_REACH)
          return;
        detail.handled = true;
        useJukeboxStore.getState().openPanel();
      },
      [spot],
    ),
  );

  if (!spot) return null;
  const click = (event: ThreeEvent<MouseEvent>) => {
    if (event.nativeEvent.button !== 0) return;
    event.stopPropagation();
    const p = usePlayerStore.getState();
    if (Math.hypot(p.x - spot.stand.x, p.z - spot.stand.z) <= JUKEBOX_REACH) {
      useJukeboxStore.getState().openPanel();
      return;
    }
    if (p.setTarget(spot.stand.x, spot.stand.z)) pending.current = true;
  };

  return (
    <group name="jukebox" position={[spot.x, 0, spot.z]}>
      <mesh
        name="jukebox-hotspot"
        // Hit target only: invisible objects still take pointer events but cost no draw call.
        visible={false}
        position={[0, 0.8, 0]}
        onClick={click}
        onPointerOver={(e) => {
          e.stopPropagation();
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => {
          document.body.style.cursor = "";
        }}
      >
        <boxGeometry args={[spot.w + 0.2, 1.6, spot.d + 0.2]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
      </mesh>
      <mesh ref={lamp} name="jukebox-lamp" position={[0, LAMP_HEIGHT, 0]}>
        <sphereGeometry args={[0.08, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshBasicMaterial color={playing ? "#F2C200" : "#4A3B22"} toneMapped={false} />
      </mesh>
    </group>
  );
}
