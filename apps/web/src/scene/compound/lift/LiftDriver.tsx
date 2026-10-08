/**
 * The lift in the scene (SPEC §14 D26, §9.2; #269): using it and its
 * lettering. The shaft housing and its sliding door are kit pieces
 * (interiors.ts; the door opens for whoever stands at it, Doors.tsx).
 *
 * Using it: a click on the lift walks over and opens the lift's panel on
 * arrival; `E` opens it from the spot in front of the door. The panel
 * (ui/lift/LiftPanel.tsx) lists the levels this viewer can reach.
 *
 * Lettering: the indicator over the door and a blade sign beside it say
 * which level this is; on a landing, the level's name is stencilled on the
 * north wall. Three small textures, repainted only when the level changes.
 */
import type { ThreeEvent } from "@react-three/fiber";
import { useFrame } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useBuildingStore } from "../../../state/building.ts";
import { type LevelLabel, levelLabelOf } from "../../../state/level.ts";
import { LIFT_OVERLAY, useLiftStore } from "../../../state/lift.ts";
import { usePlayerStore } from "../../../state/player.ts";
import { useUiStore } from "../../../state/ui.ts";
import type { HotkeyEventDetail } from "../../../ui/hotkeys/registry.ts";
import { useHotkeyEvents } from "../../../ui/hotkeys/useHotkeys.ts";
import { WALL_HEIGHT } from "../../lair/dimensions.ts";
import { LIFT_SHAFT } from "../../lair/geometry/lift.ts";
import { specialDressing } from "../special.ts";
import type { CompoundWorld } from "../world.ts";
import {
  BLADE_PX,
  bladeTexture,
  INDICATOR_PX,
  indicatorTexture,
  LEVEL_SIGN_PX,
  levelSignTexture,
} from "./signs.ts";
import { atLift, liftOf } from "./spot.ts";

/** A world without published levels (the dev harness, the first frames): the lobby level's label. */
const LOBBY_LABEL: LevelLabel = { mark: "L", title: "Lobby level", caption: "Lobby level" };

const INDICATOR_W = 1.7;
const INDICATOR_H = (INDICATOR_W * INDICATOR_PX.h) / INDICATOR_PX.w;
const BLADE_W = 0.8;
const BLADE_H = (BLADE_W * BLADE_PX.h) / BLADE_PX.w;
/** The blade sign hangs this far along the housing's front from the door's middle, metres. */
const BLADE_ASIDE = LIFT_SHAFT.w / 2 - 0.3;

function openPanel() {
  if (useLiftStore.getState().ride) return;
  useUiStore.getState().openOverlay(LIFT_OVERLAY);
}

export function LiftDriver({ world }: { world: CompoundWorld }) {
  const lift = useMemo(() => liftOf(world), [world]);
  const levels = useBuildingStore((s) => s.state?.levels);
  const label = useMemo(
    () => levelLabelOf({ levels }, world.levelId) ?? LOBBY_LABEL,
    [levels, world.levelId],
  );
  const key = `${label.mark}|${label.title}|${label.caption}`;
  const indicator = useMemo(() => indicatorTexture(label), [key]);
  const blade = useMemo(() => bladeTexture(label), [key]);
  const landing = lift?.room.kind === "landing";
  const wall = useMemo(() => (landing ? levelSignTexture(label) : null), [key, landing]);
  useEffect(() => () => indicator?.dispose(), [indicator]);
  useEffect(() => () => blade?.dispose(), [blade]);
  useEffect(() => () => wall?.dispose(), [wall]);

  // A click walks over; the panel opens on arrival, unless the player went elsewhere.
  const pending = useRef(false);
  useFrame(() => {
    if (!pending.current || !lift) return;
    const p = usePlayerStore.getState();
    if (atLift(lift, p) && !p.path) {
      pending.current = false;
      openPanel();
    } else if (!p.target) pending.current = false;
  });

  useHotkeyEvents(
    useCallback(
      (detail: HotkeyEventDetail) => {
        if (detail.id !== "interact" || detail.handled || !lift) return;
        const p = usePlayerStore.getState();
        if (!p.spawned || !atLift(lift, p)) return;
        detail.handled = true;
        openPanel();
      },
      [lift],
    ),
  );

  if (!lift) return null;
  const click = (event: ThreeEvent<MouseEvent>) => {
    if (event.nativeEvent.button !== 0) return;
    event.stopPropagation();
    const p = usePlayerStore.getState();
    if (atLift(lift, p)) {
      openPanel();
      return;
    }
    if (p.setTarget(lift.stand.x, lift.stand.z)) pending.current = true;
  };
  const cx = lift.rect.x + lift.rect.w / 2;
  const cz = lift.rect.z + lift.rect.d / 2;
  const sign = landing
    ? specialDressing("landing", lift.room.size.w, lift.room.size.d).levelSign
    : undefined;
  return (
    <group name="lift">
      <mesh
        name="lift-hotspot"
        // Hit target only: invisible objects still take pointer events but cost no draw call.
        visible={false}
        position={[cx, LIFT_SHAFT.h / 2, cz]}
        onClick={click}
        onPointerOver={(e) => {
          e.stopPropagation();
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => {
          document.body.style.cursor = "";
        }}
      >
        <boxGeometry args={[lift.rect.w + 0.3, LIFT_SHAFT.h, lift.rect.d + 0.2]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
      </mesh>
      {/* The indicator on the door's header, facing out of the lift (west). */}
      <mesh
        name="lift-indicator"
        position={[lift.door.x - 0.04, WALL_HEIGHT - 0.22, lift.door.z]}
        rotation-y={-Math.PI / 2}
        raycast={() => null}
      >
        <planeGeometry args={[INDICATOR_W, INDICATOR_H]} />
        <meshBasicMaterial map={indicator} toneMapped={false} />
      </mesh>
      {/* The blade sign: out from the housing over the door, read from along the wall, both ways. */}
      {[0, Math.PI].map((yaw) => (
        <mesh
          key={yaw}
          name="lift-blade"
          position={[
            lift.door.x - 0.1 - BLADE_W / 2,
            WALL_HEIGHT - 0.55 + BLADE_H / 2,
            // On the south pylon, clear of the indicator over the doorway.
            lift.door.z + BLADE_ASIDE + (yaw === 0 ? 0.01 : -0.01),
          ]}
          rotation-y={yaw}
          raycast={() => null}
        >
          <planeGeometry args={[BLADE_W, BLADE_H]} />
          <meshBasicMaterial map={blade} toneMapped={false} />
        </mesh>
      ))}
      {sign && (
        <mesh
          name="level-sign"
          position={[
            lift.room.origin.x + sign.position[0],
            sign.position[1],
            lift.room.origin.z + sign.position[2],
          ]}
          rotation-y={sign.rotationY}
          raycast={() => null}
        >
          <planeGeometry args={[sign.w, (sign.w * LEVEL_SIGN_PX.h) / LEVEL_SIGN_PX.w]} />
          <meshBasicMaterial map={wall} toneMapped={false} />
        </mesh>
      )}
    </group>
  );
}
