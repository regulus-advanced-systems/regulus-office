/** Net layer entry: one `OfficeClient` per page, wired to the Colyseus transport. */
import { useSessionStore } from "../state/session.ts";
import { useUiStore } from "../state/ui.ts";
import { ColyseusTransport } from "./colyseusTransport.ts";
import { OfficeClient } from "./officeClient.ts";
import { officeServerUrl } from "./serverUrl.ts";

export { backoffDelay, backoffSchedule, DEFAULT_BACKOFF } from "./backoff.ts";
export { OfficeClient } from "./officeClient.ts";
export { officeServerUrl, resolveServerUrl } from "./serverUrl.ts";
export type { RoomHandle, RoomTransport } from "./transport.ts";
export { ROOM_NAMES } from "./transport.ts";

let shared: OfficeClient | null = null;

export function getOfficeClient(): OfficeClient {
  if (!shared) {
    shared = new OfficeClient({
      transport: new ColyseusTransport(officeServerUrl()),
      onAccess: (notice) => {
        useUiStore.getState().toast({ kind: "warning", message: notice.message, durationMs: 0 });
        // Signed out elsewhere: ask the server who we are, which shows the sign-in page.
        if (notice.kind === "signedOut") void useSessionStore.getState().fetchSession();
      },
    });
  }
  return shared;
}
