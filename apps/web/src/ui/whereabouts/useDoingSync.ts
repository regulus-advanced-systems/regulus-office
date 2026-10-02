/**
 * Tell the office what the player is doing (#49, `doing`): derived from
 * which panel is open (a henchman's terminal or changes, a board, the task
 * queue, build mode, settings). Generic on purpose: the whereabouts panel
 * shows it to everyone, including people who may not enter the room.
 */
import { useEffect } from "react";
import { getOfficeClient } from "../../net/index.ts";
import { useConnectionStore } from "../../state/connection.ts";
import { useUiStore } from "../../state/ui.ts";
import { useBoardStore } from "../boards/boardStore.ts";
import { BUILD_MODE_OVERLAY } from "../build-mode/store.ts";
import { useChangesWindow } from "../changes/changesStore.ts";
import { useQueueStore } from "../queue/queueStore.ts";
import { useTerminalModal } from "../terminal/terminalStore.ts";

export interface DoingInputs {
  terminal: boolean;
  changes: boolean;
  board: "issue" | "pr" | null;
  queue: boolean;
  overlay: string | null;
}

/** The status line for what is open, most specific first; "" when nothing is. */
export function doingFor(i: DoingInputs): string {
  if (i.terminal) return "watching a henchman's terminal";
  if (i.changes) return "reviewing a henchman's changes";
  if (i.board === "issue") return "at the issue board";
  if (i.board === "pr") return "at the PR board";
  if (i.queue) return "at the task queue";
  if (i.overlay === BUILD_MODE_OVERLAY) return "building a room";
  if (i.overlay === "settings") return "in settings";
  return "";
}

function current(): string {
  const board = useBoardStore.getState().open;
  return doingFor({
    terminal: useTerminalModal.getState().agentId !== null,
    changes: useChangesWindow.getState().agentId !== null,
    board: board === "issue" || board === "pr" ? board : null,
    queue: useQueueStore.getState().panelOpen,
    overlay: useUiStore.getState().overlay,
  });
}

/** Keep the player's `doing` current; re-sent after a reconnect. */
export function useDoingSync(): void {
  useEffect(() => {
    let sent: string | null = null;
    const sync = () => {
      const doing = current();
      if (doing === sent) return;
      try {
        getOfficeClient().send("doing", { doing });
        sent = doing;
      } catch {
        // Not joined yet; the connection subscription below retries.
      }
    };
    sync();
    const unsubs = [
      useTerminalModal.subscribe(sync),
      useChangesWindow.subscribe(sync),
      useBoardStore.subscribe(sync),
      useQueueStore.subscribe(sync),
      useUiStore.subscribe((s, prev) => {
        if (s.overlay !== prev.overlay) sync();
      }),
      useConnectionStore.subscribe((s, prev) => {
        if (s.status === "connected" && prev.status !== "connected") {
          sent = null;
          sync();
        }
      }),
    ];
    return () => {
      for (const u of unsubs) u();
    };
  }, []);
}
