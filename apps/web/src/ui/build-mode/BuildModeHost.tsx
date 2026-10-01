/**
 * Mounts build mode in the HUD (#187): the build console while placing or
 * moving a room, its keys and server checks, the confirm (place or move),
 * and afterwards the new room's status panel while it is built.
 *
 * A refused spot keeps build mode open with the server's reason. Any other
 * refusal of a new room (a bad repo, a missing token) sends the owner back
 * to the Add floor dialog with what they typed, tokens excepted.
 */
import { useCallback, useEffect, useMemo } from "react";
import { roomAt } from "../../scene/compound/world.ts";
import { statsEnabled } from "../../scene/perf/stats.ts";
import { useCompoundStore } from "../../state/compound.ts";
import { useFloorsStore } from "../../state/floors.ts";
import { usePlayerStore } from "../../state/player.ts";
import { useUiStore } from "../../state/ui.ts";
import { describeFloorError } from "../floors/api.ts";
import { type CompoundApi, createCompoundApi } from "./api.ts";
import { BuildModePanel } from "./BuildModePanel.tsx";
import { FloorAddedPanel } from "./FloorAddedPanel.tsx";
import { useBuildFollowers, useBuildModeKeys, useGhostCheck } from "./hooks.ts";
import { describeRefusal, placementKey } from "./logic.ts";
import { returnToAddFloor } from "./returnDraft.ts";
import { buildProbe, useBuildModeStore } from "./store.ts";

declare global {
  interface Window {
    /** Build mode for e2e (`?stats` only). */
    __regulusBuild?: typeof buildProbe;
  }
}

const defaultApi = createCompoundApi();

/** Place or move the room at the ghost's spot. */
export async function confirmBuild(api: CompoundApi): Promise<void> {
  const s = useBuildModeStore.getState();
  const world = useCompoundStore.getState().world;
  const intent = s.intent;
  if (!intent || !world || s.busy) return;
  const placement = s.placement();
  s.setBusy(true);
  if (intent.kind === "create") {
    const res = await api.place({ ...intent.request, placement });
    if (res.ok) {
      useFloorsStore.getState().upsert(res.data.floor);
      useBuildModeStore.getState().finish({ placed: res.data.floor.floorId });
      return;
    }
    if (res.placement) {
      const { reason, conflicts } = res.placement;
      s.setServer({ key: placementKey(placement), ok: false, reason, conflicts });
      s.setBusy(false, describeRefusal(world, reason, conflicts));
      return;
    }
    if (res.status === 400) {
      useBuildModeStore.getState().finish();
      returnToAddFloor(intent.request, describeFloorError(res));
      return;
    }
    s.setBusy(false, describeFloorError(res));
    return;
  }
  // Move: whoever stands in the room goes with it, to its new door.
  const player = usePlayerStore.getState();
  const inside = roomAt(world, player.x, player.z)?.id === intent.floorId;
  const res = await api.move(intent.floorId, placement);
  if (res.ok) {
    useBuildModeStore
      .getState()
      .finish(inside ? { moved: { floorId: intent.floorId, placement } } : {});
    return;
  }
  if (res.placement) {
    const { reason, conflicts } = res.placement;
    s.setServer({ key: placementKey(placement), ok: false, reason, conflicts });
    s.setBusy(false, describeRefusal(world, reason, conflicts));
  } else if (res.code === "room_has_running_robots") {
    const n = res.robots?.length ?? 0;
    s.setBusy(
      false,
      `${n === 1 ? "A henchman is" : `${n || "Some"} henchmen are`} running in this room. Send them home first, then move it.`,
    );
  } else s.setBusy(false, describeFloorError(res));
}

export function BuildModeHost({ api = defaultApi }: { api?: CompoundApi }) {
  const active = useBuildModeStore((s) => s.intent !== null);
  const added = useBuildModeStore((s) => s.added);
  const overlay = useUiStore((s) => s.overlay);
  const confirm = useCallback(() => void confirmBuild(api), [api]);
  useGhostCheck(api);
  useBuildModeKeys(confirm);
  useBuildFollowers();

  // Another dialog took over the screen: build mode ends with it.
  useEffect(() => {
    if (active && overlay !== "build-mode") useBuildModeStore.getState().cancel();
  }, [active, overlay]);

  const probe = useMemo(() => statsEnabled(window.location.search), []);
  useEffect(() => {
    if (!probe) return;
    window.__regulusBuild = buildProbe;
    return () => {
      window.__regulusBuild = undefined;
    };
  }, [probe]);

  if (active) return <BuildModePanel onConfirm={confirm} />;
  if (added) return <FloorAddedPanel floorId={added} />;
  return null;
}
