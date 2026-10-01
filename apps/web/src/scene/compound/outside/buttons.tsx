/**
 * Pressing the blast door's button (#188, SPEC §9.2 "E interacts with the
 * nearest interactable ... blast-door button"): the lobby wall button and
 * the keypad outside are click targets (walk over, then press on arrival)
 * and `E` presses whichever is in reach. The press goes to the BuildingRoom
 * (`blast_door.press`), which checks the reach again, rate-limits and
 * audits it; a refusal comes back as a toast, and when someone else opens
 * the door everybody gets a short notice.
 */
import type { ThreeEvent } from "@react-three/fiber";
import { useFrame } from "@react-three/fiber";
import {
  BLAST_DOOR_BUTTON_REACH,
  BLAST_DOOR_PRESS,
  type BlastDoorButton,
  type CommandRejected,
} from "@regulus/protocol";
import { useCallback, useEffect, useRef } from "react";
import { getOfficeClient } from "../../../net/index.ts";
import { useBuildingStore } from "../../../state/building.ts";
import { usePlayerStore } from "../../../state/player.ts";
import { useUiStore } from "../../../state/ui.ts";
import type { HotkeyEventDetail } from "../../../ui/hotkeys/registry.ts";
import { useHotkeyEvents } from "../../../ui/hotkeys/useHotkeys.ts";
import type { OutsideLayout } from "./layout.ts";

/** Send a press; false when the building room is not joined (the dev harness). */
export function pressBlastDoor(send?: () => void): boolean {
  try {
    if (send) send();
    else getOfficeClient().send(BLAST_DOOR_PRESS, {});
    return true;
  } catch {
    return false;
  }
}

/** The button the player stands at, if any. */
export function buttonInReach(
  layout: OutsideLayout,
  p: { x: number; z: number },
): BlastDoorButton | null {
  for (const b of layout.buttons) {
    if (Math.hypot(b.stand.x - p.x, b.stand.z - p.z) <= BLAST_DOOR_BUTTON_REACH) return b;
  }
  return null;
}

export function ButtonPanels({ layout }: { layout: OutsideLayout }) {
  // A click walks over; the press goes out on arrival, unless the player went elsewhere.
  const pending = useRef<BlastDoorButton | null>(null);
  useFrame(() => {
    const b = pending.current;
    if (!b) return;
    const p = usePlayerStore.getState();
    const near = Math.hypot(b.stand.x - p.x, b.stand.z - p.z) <= BLAST_DOOR_BUTTON_REACH;
    if (near && !p.path) {
      pending.current = null;
      pressBlastDoor();
      return;
    }
    const heading = p.target && Math.hypot(p.target.x - b.stand.x, p.target.z - b.stand.z) < 0.01;
    if (!heading && !near) pending.current = null;
  });

  useHotkeyEvents(
    useCallback(
      (detail: HotkeyEventDetail) => {
        if (detail.id !== "interact") return;
        const p = usePlayerStore.getState();
        if (!p.spawned || !buttonInReach(layout, p)) return;
        detail.handled = true;
        pressBlastDoor();
      },
      [layout],
    ),
  );

  const click = (b: BlastDoorButton) => (event: ThreeEvent<MouseEvent>) => {
    if (event.nativeEvent.button !== 0) return;
    event.stopPropagation();
    const p = usePlayerStore.getState();
    if (Math.hypot(b.stand.x - p.x, b.stand.z - p.z) <= BLAST_DOOR_BUTTON_REACH) {
      pressBlastDoor();
      return;
    }
    if (p.setTarget(b.stand.x, b.stand.z)) pending.current = b;
  };

  return (
    <group name="blast-door-buttons">
      {layout.buttons.map((b) => (
        <mesh
          key={b.side}
          name={`blast-door-button-${b.side}`}
          // Hit target only: invisible objects still take pointer events but cost no draw call.
          visible={false}
          position={[b.wall.x, 1.3, b.wall.z + (b.side === "inside" ? -0.2 : 0.55)]}
          onClick={click(b)}
          onPointerOver={(e) => {
            e.stopPropagation();
            document.body.style.cursor = "pointer";
          }}
          onPointerOut={() => {
            document.body.style.cursor = "";
          }}
        >
          <boxGeometry args={[0.7, 0.9, 0.4]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
        </mesh>
      ))}
    </group>
  );
}

/** Players this close to the door (metres) are told who opened it. */
export const NOTICE_RADIUS = 40;

/**
 * Toasts for the door: a refused press says why; a door opened by someone
 * else, seen live (not on arrival) by a player near the door, says who.
 */
export function useBlastDoorNotices(layout: OutsideLayout): void {
  useEffect(() => {
    let off: (() => void) | undefined;
    try {
      off = getOfficeClient().onRejected((r: CommandRejected) => {
        if (r.type !== BLAST_DOOR_PRESS) return;
        useUiStore.getState().toast({ kind: "error", message: r.reason });
      });
    } catch {
      off = undefined;
    }
    const unsub = useBuildingStore.subscribe((s, prev) => {
      const now = s.state?.blastDoor;
      const was = prev.state?.blastDoor;
      if (!now || !was || now.presses === was.presses || now.openedBy === "") return;
      if (was.phase !== "closed") return;
      const me = s.sessionId ? s.state?.humans[s.sessionId] : undefined;
      if (me && me.displayName === now.openedBy) return;
      const p = usePlayerStore.getState();
      const far = Math.hypot(p.x - layout.door.centre, p.z - layout.edgeZ) > NOTICE_RADIUS;
      if (!p.spawned || far) return;
      const secs = Math.round((now.closesAt - now.openedAt) / 1000);
      useUiStore.getState().toast({
        kind: "info",
        title: "Blast door",
        message: `${now.openedBy} opened the blast door. It shuts in ${secs} s.`,
      });
    });
    return () => {
      off?.();
      unsub();
    };
  }, [layout]);
}
