/**
 * Taking a cup from the break-room coffee machine (#63; SPEC §9.1 special
 * rooms, D9): the machine is a click target (walk over, then drink on
 * arrival) and `E` takes a cup when it is in reach. The request goes to the
 * BuildingRoom (`coffee.drink`), which checks where the player stands and
 * grants the buzz on their presence; a refusal comes back as a toast.
 *
 * Mounted on every level, because it also keeps the local player's speed in
 * step with their buzz (`useBuzzSpeed`): the boost follows what the server
 * published, starts with the first cup and ends when the server ends it.
 */
import { type ThreeEvent, useFrame } from "@react-three/fiber";
import {
  BUZZ_MS,
  BUZZ_SPEED_BOOST,
  buzzSpeedBoost,
  COFFEE_DRINK,
  COFFEE_REACH,
  type CommandRejected,
  hasJitters,
  JITTER_CUPS,
} from "@regulus/protocol";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { getOfficeClient } from "../../net/index.ts";
import { useBuildingStore } from "../../state/building.ts";
import { usePlayerStore } from "../../state/player.ts";
import { useUiStore } from "../../state/ui.ts";
import type { HotkeyEventDetail } from "../../ui/hotkeys/registry.ts";
import { useHotkeyEvents } from "../../ui/hotkeys/useHotkeys.ts";
import type { CompoundWorld } from "../compound/world.ts";
import { setSpeedBoost } from "../movement/gait.ts";
import { statsEnabled } from "../perf/stats.ts";
import { coffeeSpotOf, selectSelfBuzz } from "./buzz.ts";
import { createCoffeeProbe } from "./probe.ts";

/** Ask for a cup; false when the building room is not joined (the dev harness). */
export function drinkCoffee(send?: () => void): boolean {
  try {
    if (send) send();
    else getOfficeClient().send(COFFEE_DRINK, {});
    return true;
  } catch {
    return false;
  }
}

/** Is the player standing at the machine? */
export function coffeeInReach(
  stand: { x: number; z: number } | null,
  p: { x: number; z: number },
): boolean {
  return stand !== null && Math.hypot(stand.x - p.x, stand.z - p.z) <= COFFEE_REACH;
}

/** What a newly granted cup says to its drinker. */
export function cupMessage(cups: number): string {
  const percent = Math.round((BUZZ_SPEED_BOOST - 1) * 100);
  const seconds = Math.round(BUZZ_MS / 1000);
  if (cups === JITTER_CUPS) return `Cup ${cups}: you have the jitters. Still ${percent}% faster.`;
  if (hasJitters({ cups })) return `Another cup. The buzz lasts ${seconds} s more.`;
  return `Coffee: you walk and run ${percent}% faster for ${seconds} s.`;
}

/** The local player moves as fast as their buzz, as the server published it, allows. */
export function useBuzzSpeed(): void {
  useEffect(() => {
    const apply = () => setSpeedBoost(buzzSpeedBoost(selectSelfBuzz(useBuildingStore.getState())));
    apply();
    const unsub = useBuildingStore.subscribe(apply);
    return () => {
      unsub();
      setSpeedBoost(1);
    };
  }, []);
}

/** Toasts: why a cup was refused, and what a granted one does. */
export function useCoffeeNotices(): void {
  useEffect(() => {
    let off: (() => void) | undefined;
    try {
      off = getOfficeClient().onRejected((r: CommandRejected) => {
        if (r.type !== COFFEE_DRINK) return;
        useUiStore.getState().toast({ kind: "error", message: r.reason });
      });
    } catch {
      off = undefined;
    }
    const unsub = useBuildingStore.subscribe((s, prev) => {
      const now = selectSelfBuzz(s);
      const was = selectSelfBuzz(prev);
      // Our own entry, already there before: a cup we took now, not one we arrived with.
      if (!now || !was || s.sessionId !== prev.sessionId) return;
      if (now.buzzUntil <= was.buzzUntil || now.cups === 0) return;
      useUiStore.getState().toast({ kind: "info", title: "Coffee", message: cupMessage(now.cups) });
    });
    return () => {
      off?.();
      unsub();
    };
  }, []);
}

export function CoffeeMachine({ world }: { world: CompoundWorld }) {
  useBuzzSpeed();
  useCoffeeNotices();
  const spot = useMemo(() => coffeeSpotOf(world), [world]);
  const stand = spot?.stand ?? null;

  useEffect(() => {
    if (!statsEnabled(window.location.search)) return;
    window.__regulusCoffee = createCoffeeProbe(() => stand);
    return () => {
      window.__regulusCoffee = undefined;
    };
  }, [stand]);

  // A click walks over; the cup is taken on arrival, unless the player went elsewhere.
  const pending = useRef(false);
  useFrame(() => {
    if (!pending.current || !stand) return;
    const p = usePlayerStore.getState();
    const near = coffeeInReach(stand, p);
    if (near && !p.path) {
      pending.current = false;
      drinkCoffee();
      return;
    }
    const heading = p.target && Math.hypot(p.target.x - stand.x, p.target.z - stand.z) < 0.01;
    if (!heading && !near) pending.current = false;
  });

  useHotkeyEvents(
    useCallback(
      (detail: HotkeyEventDetail) => {
        if (detail.id !== "interact" || detail.handled) return;
        const p = usePlayerStore.getState();
        if (!p.spawned || !coffeeInReach(stand, p)) return;
        detail.handled = true;
        drinkCoffee();
      },
      [stand],
    ),
  );

  if (!spot || !stand) return null;
  const onClick = (event: ThreeEvent<MouseEvent>) => {
    if (event.nativeEvent.button !== 0) return;
    event.stopPropagation();
    const p = usePlayerStore.getState();
    if (coffeeInReach(stand, p)) {
      drinkCoffee();
      return;
    }
    if (p.setTarget(stand.x, stand.z)) pending.current = true;
  };
  return (
    <mesh
      name="coffee-machine-target"
      // Hit target only: invisible objects still take pointer events but cost no draw call.
      visible={false}
      position={[spot.rect.x + spot.rect.w / 2, 0.8, spot.rect.z + spot.rect.d / 2]}
      onClick={onClick}
      onPointerOver={(e) => {
        e.stopPropagation();
        document.body.style.cursor = "pointer";
      }}
      onPointerOut={() => {
        document.body.style.cursor = "";
      }}
    >
      <boxGeometry args={[spot.rect.w, 1.6, spot.rect.d]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
    </mesh>
  );
}
