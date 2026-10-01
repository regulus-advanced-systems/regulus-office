/**
 * Client side of the merge gong's messages (#43): `pr.merged` and `gong.ring`
 * from the OperationRoom ring it (store, sound) and a merge also shows a toast;
 * a refused `gong.bang` says why. Payloads are validated with the protocol
 * schemas, and a message for another operation than ours is ignored. Changing
 * operations forgets the last ring.
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
import { useOperationStore } from "../../state/operation.ts";
import { selectReducedMotion, useUiStore } from "../../state/ui.ts";
import { useGongStore } from "./gongStore.ts";
import { playGong } from "./gongSynth.ts";

type Toast = (input: {
  kind: "success" | "error" | "info";
  title?: string;
  message: string;
}) => void;

export interface GongSyncDeps {
  client: Pick<OfficeClient, "onOperationMessage" | "onRejected">;
  store?: typeof useGongStore;
  operation?: typeof useOperationStore;
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
  const operation = deps.operation ?? useOperationStore;
  const play = deps.play ?? playWithSettings;
  const toast: Toast = deps.toast ?? ((input) => void useUiStore.getState().toast(input));
  const here = (operationId: string) => operation.getState().operationId === operationId;

  const offs = [
    deps.client.onOperationMessage(PR_MERGED_MESSAGE, (payload) => {
      const parsed = PrMerged.safeParse(payload);
      if (!parsed.success || !here(parsed.data.operationId)) return;
      const { operationId, number, title } = parsed.data;
      store.getState().heard({ operationId, cause: "merge", strikes: GONG_STRIKES.merge });
      play(GONG_STRIKES.merge);
      toast({
        kind: "success",
        title: "Pull request merged",
        message: `#${number} ${title}`.trim(),
      });
    }),
    deps.client.onOperationMessage(GONG_RING_MESSAGE, (payload) => {
      const parsed = GongRing.safeParse(payload);
      if (!parsed.success || !here(parsed.data.operationId)) return;
      const { operationId, cause, strikes } = parsed.data;
      store.getState().heard({ operationId, cause, strikes });
      play(strikes);
      if (cause === "queue_empty") {
        toast({ kind: "success", message: "The task queue is done: every task is finished." });
      }
    }),
    deps.client.onRejected((notice: CommandRejected) => {
      if (notice.type === "gong.bang") toast({ kind: "info", message: notice.reason });
    }),
  ];
  let operationId = operation.getState().operationId;
  offs.push(
    operation.subscribe((s) => {
      if (s.operationId === operationId) return;
      operationId = s.operationId;
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
