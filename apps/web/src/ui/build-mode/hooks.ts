/**
 * Build mode's effects (#187): asking the server about the ghost's spot
 * (debounced, answers cached per spot), its keyboard (arrows move the
 * ghost relative to the camera, R / Shift+R turn the door, Enter builds,
 * Escape cancels, Q/E still turn the camera), and following a placed room
 * until it is built, then a moved room to its new door.
 */
import { useEffect, useMemo } from "react";
import { cameraView, useCameraStore } from "../../state/camera.ts";
import { useCompoundStore } from "../../state/compound.ts";
import { travelTo } from "../../state/travel.ts";
import { isEditableTarget } from "../hotkeys/registry.ts";
import type { CompoundApi } from "./api.ts";
import { type ArrowKey, arrowStep, placementKey } from "./logic.ts";
import { ghostKey, type ServerCheck, useBuildModeStore } from "./store.ts";

const CHECK_DEBOUNCE_MS = 140;

/** Ask the server whether the ghost's spot is valid, once it rests for a moment. */
export function useGhostCheck(api: CompoundApi): void {
  const active = useBuildModeStore((s) => s.intent !== null);
  const key = useBuildModeStore(ghostKey);
  const cache = useMemo(() => new Map<string, ServerCheck>(), [active]);
  useEffect(() => {
    if (!active) return;
    const s = useBuildModeStore.getState();
    const hit = cache.get(key);
    if (hit) {
      s.setServer(hit);
      return;
    }
    let live = true;
    const timer = setTimeout(() => {
      const st = useBuildModeStore.getState();
      const placement = st.placement();
      const skip = st.intent?.kind === "move" ? st.intent.floorId : undefined;
      void api.check(placement, skip).then((res) => {
        if (!res.ok) return;
        const check: ServerCheck = {
          key: placementKey(placement),
          ok: res.data.ok,
          reason: res.data.reason,
          conflicts: res.data.conflicts,
        };
        cache.set(check.key, check);
        if (live && ghostKey(useBuildModeStore.getState()) === check.key)
          useBuildModeStore.getState().setServer(check);
      });
    }, CHECK_DEBOUNCE_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [active, key, api, cache]);
}

const ARROWS = new Set<string>(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);

/**
 * Whether a key press belongs to a control rather than to build mode: text
 * fields anywhere (the chat), and the build console's own buttons and
 * fields. A button elsewhere (the one that opened the dialog, say) does not
 * get Enter while placing.
 */
function inControl(target: EventTarget | null): boolean {
  if (isEditableTarget(target)) return true;
  if (!(target instanceof HTMLElement)) return false;
  if (!target.closest('[data-testid="build-mode"]')) return false;
  return target.tagName === "BUTTON";
}

/**
 * Build mode's keys, ahead of everything else on the page (capture phase).
 * Presses aimed at a control in the panel (a size field, a button) are left
 * to it, except Escape.
 */
export function useBuildModeKeys(confirm: () => void): void {
  const active = useBuildModeStore((s) => s.intent !== null);
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const s = useBuildModeStore.getState();
      const world = useCompoundStore.getState().world;
      if (!s.intent || !world) return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        if (!s.busy) s.cancel();
        return;
      }
      if (inControl(e.target)) return;
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      let handled = true;
      if (ARROWS.has(key)) s.nudge(world, arrowStep(key as ArrowKey, cameraView.yaw));
      else if (key === "r") s.rotate(e.shiftKey ? -1 : 1);
      else if (key === "Enter") {
        if (!e.repeat) confirm();
      } else if (key === "q") useCameraStore.getState().rotateStep(-1);
      else if (key === "e") useCameraStore.getState().rotateStep(1);
      else handled = false;
      if (handled) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [active, confirm]);
}

/** How long the reveal plays before the camera goes back in (ms). */
export const REVEAL_SETTLE_MS = 1800;

/**
 * After a room is placed: keep the overview until it is built and revealed,
 * then zoom back. After a move: once the room stands at its new spot, put
 * the mover at its door.
 */
export function useBuildFollowers(): void {
  const watching = useBuildModeStore((s) => s.watching);
  const room = useCompoundStore((s) =>
    watching ? s.world?.rooms.find((r) => r.id === watching) : undefined,
  );
  const state = room ? room.buildState : watching ? "gone" : null;
  useEffect(() => {
    if (!watching) return;
    if (state === "gone" && useCompoundStore.getState().world) {
      // Placed but not published yet, or removed: give the publish a moment.
      const t = setTimeout(() => {
        const w = useCompoundStore.getState().world;
        if (!w?.rooms.some((r) => r.id === watching)) useBuildModeStore.getState().stopWatching();
      }, 10_000);
      return () => clearTimeout(t);
    }
    if (state !== "ready") return;
    const t = setTimeout(() => useBuildModeStore.getState().stopWatching(), REVEAL_SETTLE_MS);
    return () => clearTimeout(t);
  }, [watching, state]);

  const follow = useBuildModeStore((s) => s.followMove);
  const moved = useCompoundStore((s) => {
    if (!follow) return false;
    const r = s.world?.rooms.find((x) => x.id === follow.floorId);
    const p = follow.placement;
    return Boolean(r && r.rect.x === p.gridX && r.rect.y === p.gridY && r.doorSide === p.doorSide);
  });
  useEffect(() => {
    if (!follow || !moved) return;
    // The nav grid follows the world on the next render; travel after it.
    const t = setTimeout(() => {
      travelTo(follow.floorId);
      useBuildModeStore.setState({ followMove: null });
    }, 50);
    return () => clearTimeout(t);
  }, [follow, moved]);
}
