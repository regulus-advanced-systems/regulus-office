/**
 * Client side of the merge gong's messages (#43): `pr.merged` and `gong.ring`
 * from the FloorRoom ring it (store, sound) and a merge also shows a toast;
 * a refused `gong.bang` says why. Payloads are validated with the protocol
 * schemas, and a message for another floor than ours is ignored. Changing
 * floors forgets the last ring.
 */
import {
  type CommandRejected,
  GONG_RING_MESSAGE,
  GONG_STRIKES,
  GongRing,
  PR_MERGED_MESSAGE,
  PrMerged,
} from "@regulus/protocol";
import type { OfficeClient } from "../../net/officeClient.ts";
import { useFloorStore } from "../../state/floor.ts";
import { selectReducedMotion, useUiStore } from "../../state/ui.ts";
import { useGongStore } from "./gongStore.ts";
import { playGong } from "./gongSynth.ts";

type Toast = (input: {
  kind: "success" | "error" | "info";
  title?: string;
  message: string;
}) => void;

export interface GongSyncDeps {
  client: Pick<OfficeClient, "onFloorMessage" | "onRejected">;
  store?: typeof useGongStore;
  floor?: typeof useFloorStore;
  /** Ring the synth; defaults to the office's volume and reduced-motion settings. */
  play?: (strikes: number) => void;
  toast?: Toast;
}

function playWithSettings(strikes: number): void {
  const ui = useUiStore.getState();
  playGong(strikes, { volume: ui.settings.volume, reducedMotion: selectReducedMotion(ui) });
}

/** Subscribe; returns the unsubscribe function. */
export function syncGong(deps: GongSyncDeps): () => void {
  const store = deps.store ?? useGongStore;
  const floor = deps.floor ?? useFloorStore;
  const play = deps.play ?? playWithSettings;
  const toast: Toast = deps.toast ?? ((input) => void useUiStore.getState().toast(input));
  const here = (floorId: string) => floor.getState().floorId === floorId;

  const offs = [
    deps.client.onFloorMessage(PR_MERGED_MESSAGE, (payload) => {
      const parsed = PrMerged.safeParse(payload);
      if (!parsed.success || !here(parsed.data.floorId)) return;
      const { floorId, number, title } = parsed.data;
      store.getState().heard({ floorId, cause: "merge", strikes: GONG_STRIKES.merge });
      play(GONG_STRIKES.merge);
      toast({
        kind: "success",
        title: "Pull request merged",
        message: `#${number} ${title}`.trim(),
      });
    }),
    deps.client.onFloorMessage(GONG_RING_MESSAGE, (payload) => {
      const parsed = GongRing.safeParse(payload);
      if (!parsed.success || !here(parsed.data.floorId)) return;
      const { floorId, cause, strikes } = parsed.data;
      store.getState().heard({ floorId, cause, strikes });
      play(strikes);
      if (cause === "queue_empty") {
        toast({ kind: "success", message: "The task queue is done: every task is finished." });
      }
    }),
    deps.client.onRejected((notice: CommandRejected) => {
      if (notice.type === "gong.bang") toast({ kind: "info", message: notice.reason });
    }),
  ];
  let floorId = floor.getState().floorId;
  offs.push(
    floor.subscribe((s) => {
      if (s.floorId === floorId) return;
      floorId = s.floorId;
      store.getState().forget();
    }),
  );
  return () => {
    for (const off of offs) off();
  };
}

/** Bang the gong on the floor we are on; false when no floor room is joined. */
export function bangGong(
  send: (type: "gong.bang", payload: Record<string, never>) => void,
): boolean {
  try {
    send("gong.bang", {});
    return true;
  } catch {
    return false;
  }
}
