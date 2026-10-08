/**
 * The reception desk in the scene (SPEC §9.1, D28; #60): the office PM's
 * post. A click on the counter walks over and asks for the PM on arrival;
 * `E` asks from the spot in front of it. Either opens the PM's chat window
 * (state/reception.ts), also while the PM is out on its round.
 *
 * Only on the lobby level: the other levels have no reception. Nothing is
 * drawn here (the counter is part of the lobby's dressing); the hit target
 * costs no draw call and nothing runs per frame unless a walk is pending.
 */
import { type ThreeEvent, useFrame } from "@react-three/fiber";
import { LOBBY_LEVEL_ID } from "@regulus/protocol";
import { useCallback, useMemo, useRef } from "react";
import { useBuildingStore } from "../../state/building.ts";
import { useLevelStore } from "../../state/level.ts";
import { usePlayerStore } from "../../state/player.ts";
import { askAtReception } from "../../state/reception.ts";
import { useSessionStore } from "../../state/session.ts";
import { useUiStore } from "../../state/ui.ts";
import { anyWindowOpen } from "../../state/windows.ts";
import type { HotkeyEventDetail } from "../../ui/hotkeys/registry.ts";
import { useHotkeyEvents } from "../../ui/hotkeys/useHotkeys.ts";
import { createOfficeAgentsApi } from "../../ui/office-agents/api.ts";
import type { CompoundWorld } from "../compound/world.ts";
import { atDesk, receptionSpot } from "./spot.ts";

/** The counter's top, metres: the hit target reaches a little above it. */
const HIT_HEIGHT = 1.3;

export function ReceptionDesk({ world }: { world: CompoundWorld }) {
  const onLobbyLevel = useLevelStore((s) => s.levelId === LOBBY_LEVEL_ID);
  const spot = useMemo(() => receptionSpot(world), [world]);
  const api = useMemo(() => createOfficeAgentsApi(), []);
  const pending = useRef(false);

  const ask = useCallback(() => {
    const user = useSessionStore.getState().user;
    void askAtReception({
      state: useBuildingStore.getState().state,
      viewer: user ? { id: user.id, role: user.role } : null,
      agents: async () => {
        const res = await api.list();
        return res.ok ? res.data.agents : null;
      },
      toast: (input) => useUiStore.getState().toast(input),
    });
  }, [api]);

  // A click from across the room: ask once the walk to the desk is done.
  useFrame(() => {
    if (!pending.current || !spot) return;
    const p = usePlayerStore.getState();
    if (atDesk(spot, p) && !p.path) {
      pending.current = false;
      ask();
    } else if (!p.target) pending.current = false;
  });

  useHotkeyEvents(
    useCallback(
      (detail: HotkeyEventDetail) => {
        if (detail.id !== "interact" || detail.handled || !spot || !onLobbyLevel) return;
        const p = usePlayerStore.getState();
        if (!p.spawned || anyWindowOpen() || !atDesk(spot, p)) return;
        detail.handled = true;
        ask();
      },
      [spot, onLobbyLevel, ask],
    ),
  );

  if (!spot || !onLobbyLevel) return null;
  const click = (event: ThreeEvent<MouseEvent>) => {
    if (event.nativeEvent.button !== 0) return;
    event.stopPropagation();
    const p = usePlayerStore.getState();
    if (atDesk(spot, p)) return ask();
    if (p.setTarget(spot.stand.x, spot.stand.z)) pending.current = true;
  };

  return (
    <mesh
      name="reception-hotspot"
      // Hit target only: invisible objects still take pointer events but cost no draw call.
      visible={false}
      // Read by the e2e scene probes; plain data, no behaviour.
      userData={{ standX: spot.stand.x, standZ: spot.stand.z }}
      position={[spot.desk.x + spot.desk.w / 2, HIT_HEIGHT / 2, spot.desk.z + spot.desk.d / 2]}
      onClick={click}
      onPointerOver={(e) => {
        e.stopPropagation();
        document.body.style.cursor = "pointer";
      }}
      onPointerOut={() => {
        document.body.style.cursor = "";
      }}
    >
      <boxGeometry args={[spot.desk.w + 0.1, HIT_HEIGHT, spot.desk.d + 0.1]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
    </mesh>
  );
}
