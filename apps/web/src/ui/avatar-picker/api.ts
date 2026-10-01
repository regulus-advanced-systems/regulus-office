/** Save the signed-in human's genius (`PUT /api/me/avatar`, validated by the server). */
import {
  GENIUS_AVATAR_API_PATH,
  type GeniusLookValue,
  resolveGeniusLook,
} from "@regulus/protocol/src/genius.ts";

export type SaveResult = { ok: true; look: GeniusLookValue } | { ok: false; error: string };

export async function saveGeniusLook(
  look: GeniusLookValue,
  fetchFn: typeof fetch = fetch,
): Promise<SaveResult> {
  try {
    const res = await fetchFn(GENIUS_AVATAR_API_PATH, {
      method: "PUT",
      credentials: "same-origin",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(look),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      return { ok: false, error: describe(res.status, body.error) };
    }
    const body = (await res.json()) as { avatar?: unknown };
    return { ok: true, look: resolveGeniusLook(body.avatar) };
  } catch {
    return { ok: false, error: "Could not reach the office. Try again in a moment." };
  }
}

function describe(status: number, code: string | undefined): string {
  if (status === 401) return "Your session ended. Sign in again to save your genius.";
  if (code === "invalid_body") return "That combination is not available. Pick again.";
  return `Saving failed (${status}). Try again.`;
}
