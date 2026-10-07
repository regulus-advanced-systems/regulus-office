/**
 * Take a human out of the office's LiveKit room (#244). A media token only
 * opens the connection; LiveKit keeps a connected participant for as long as
 * the browser stays, so a human who signed out, whose account is gone or
 * whose role changed is removed here when their building room seat ends
 * (the seat's session id is their LiveKit identity, media/routes.ts).
 *
 * LiveKit's RoomService is Twirp over HTTP on the signalling address:
 * `POST <url>/twirp/livekit.RoomService/RemoveParticipant` with a short-lived
 * token carrying `roomAdmin` for that room. The token is never logged.
 */
import { createHmac } from "node:crypto";
import type { MediaConfig } from "./config.ts";

/** Lifetime of the admin token: one request. */
const ADMIN_TOKEN_TTL_S = 60;
const REQUEST_TIMEOUT_MS = 5_000;

const b64url = (data: string | Buffer) => Buffer.from(data).toString("base64url");

/** The RoomService endpoint behind a signalling URL (ws → http, wss → https). */
export function removeParticipantUrl(signallingUrl: string): string {
  const u = new URL(signallingUrl);
  u.protocol = u.protocol === "wss:" || u.protocol === "https:" ? "https:" : "http:";
  u.pathname = `${u.pathname.replace(/\/$/, "")}/twirp/livekit.RoomService/RemoveParticipant`;
  u.search = "";
  u.hash = "";
  return u.toString();
}

/** A token that may administer `room` and nothing else. */
export function mintRoomAdminToken(
  config: Pick<MediaConfig, "apiKey" | "apiSecret" | "room">,
  now: number,
): string {
  const nowS = Math.floor(now / 1000);
  const claims = {
    iss: config.apiKey,
    sub: "office-server",
    nbf: nowS - 10,
    exp: nowS + ADMIN_TOKEN_TTL_S,
    video: { room: config.room, roomAdmin: true },
  };
  const head = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify(claims));
  const signature = createHmac("sha256", config.apiSecret.expose())
    .update(`${head}.${body}`)
    .digest();
  return `${head}.${body}.${b64url(signature)}`;
}

export interface RemoveParticipantOptions {
  fetch?: typeof fetch;
  now?: () => number;
}

/**
 * Remove `identity` from the media room. True when LiveKit removed them or
 * they were not connected (404); false when LiveKit could not be reached or
 * refused, which the caller logs.
 */
export async function removeParticipant(
  config: MediaConfig,
  identity: string,
  options: RemoveParticipantOptions = {},
): Promise<boolean> {
  const doFetch = options.fetch ?? fetch;
  const token = mintRoomAdminToken(config, (options.now ?? Date.now)());
  try {
    const res = await doFetch(removeParticipantUrl(config.url), {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ room: config.room, identity }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    await res.body?.cancel();
    return res.ok || res.status === 404;
  } catch {
    return false;
  }
}
