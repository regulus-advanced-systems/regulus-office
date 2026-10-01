/** Sending jukebox commands to the BuildingRoom, and hearing why one was refused (#47). */
import type { ClientCommandPayload, CommandRejected } from "@regulus/protocol";
import { useEffect, useState } from "react";
import { getOfficeClient } from "../../net/index.ts";

export type JukeboxCommandType =
  | "jukebox.play"
  | "jukebox.pause"
  | "jukebox.seek"
  | "jukebox.enqueue"
  | "jukebox.skip"
  | "jukebox.remove"
  | "jukebox.volume";

export type JukeboxSend = <T extends JukeboxCommandType>(
  type: T,
  payload: ClientCommandPayload<T>,
) => void;

export const officeJukeboxSend: JukeboxSend = (type, payload) =>
  getOfficeClient().send(type, payload);

/** The last refusal of a jukebox command, and a setter to clear it. */
export function useJukeboxRejections(): [string | null, (message: string | null) => void] {
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let off: (() => void) | undefined;
    try {
      off = getOfficeClient().onRejected((notice: CommandRejected) => {
        if (notice.type.startsWith("jukebox.") && notice.type !== "jukebox.duration")
          setError(notice.reason);
      });
    } catch {
      // Not connected (tests).
    }
    return () => off?.();
  }, []);
  return [error, setError];
}
