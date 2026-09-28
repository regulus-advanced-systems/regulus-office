/** Net layer entry: one `OfficeClient` per page, wired to the Colyseus transport. */
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
  if (!shared) shared = new OfficeClient({ transport: new ColyseusTransport(officeServerUrl()) });
  return shared;
}
