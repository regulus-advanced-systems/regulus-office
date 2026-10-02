/**
 * The office's media REST (#48): is LiveKit configured here, and a token
 * for this page's building session. Media never goes through the office;
 * the token lets the browser talk to LiveKit directly.
 */
import {
  MEDIA_STATUS_API_PATH,
  MEDIA_TOKEN_API_PATH,
  type MediaStatus,
  type MediaToken,
} from "@regulus/protocol";

export const MEDIA_OFF: MediaStatus = { enabled: false, canPublish: false };

/** Whether media is on, and whether this human may talk and share; off on any failure. */
export async function fetchMediaStatus(fetchFn: typeof fetch = fetch): Promise<MediaStatus> {
  try {
    const res = await fetchFn(MEDIA_STATUS_API_PATH, {
      credentials: "same-origin",
      headers: { accept: "application/json" },
    });
    if (!res.ok) return MEDIA_OFF;
    const body = (await res.json()) as Partial<MediaStatus>;
    return { enabled: body.enabled === true, canPublish: body.canPublish === true };
  } catch {
    return MEDIA_OFF;
  }
}

export type TokenResult = { ok: true; token: MediaToken } | { ok: false; status: number };

/** A LiveKit token whose identity is `sessionId` (our building room session). */
export async function fetchMediaToken(
  sessionId: string,
  fetchFn: typeof fetch = fetch,
): Promise<TokenResult> {
  try {
    const res = await fetchFn(MEDIA_TOKEN_API_PATH, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ sessionId }),
    });
    if (!res.ok) return { ok: false, status: res.status };
    return { ok: true, token: (await res.json()) as MediaToken };
  } catch {
    return { ok: false, status: 0 };
  }
}
